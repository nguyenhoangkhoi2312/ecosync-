# ECON — Backend Architecture (Buildable Spec)

> Single source of truth for the ECON backend. If you're an agent continuing this work, build
> to THIS document. Everything described here is implemented and verified unless a line says
> "TODO / needs hardware". The golden rule for the dashboard: **never hard-code a metric — it
> must trace back to a value the Go engine actually computes and streams.**

---

## 0. TL;DR data flow

```
  [ Edge / CV ]                 [ Core Engine ]                [ Digital Twin ]
  ESP32 sensors   ── MQTT ──►   Go physics engine   ── WS/FlatBuffers ──►  React dashboard
  YOLO (Mac M4)   telemetry/+   (econ/server)        binary 30 fps          (econ/dashboard)
                                     │  ▲
                                     │  └──── manual override (WS text) ──── dashboard
                                     └──── MQTT commands/<zone> ──────────►  ESP32 actuators
```

Three processes, three protocols:
1. **MQTT (TCP 1883)** — occupancy/sensor telemetry IN, actuation commands OUT. Broker = Mosquitto.
2. **WebSocket (TCP 8080, binary FlatBuffers)** — physics state OUT to the dashboard at ~30 fps; scenario/override text IN from the dashboard.
3. **HTTP (TCP 8080)** — static `building-data.json` + `brick-ontology.json` for the dashboard to bootstrap geometry/topology.

The Go engine is the **single brain**. (The Python `raspberry_backend/server.py` is a legacy MQTT↔WS bridge and is now redundant — keep the Pi only as the Mosquitto host.)

---

## 1. Components & ports

| Component | Path | Lang | Listens | Talks to |
|---|---|---|---|---|
| **Core engine** | `econ/server/` | Go 1.22 | WS+HTTP `:8080` | MQTT broker, dashboard |
| **MQTT broker** | `eclipse-mosquitto:2` (compose) | — | `:1883` | engine, edge nodes |
| **TimescaleDB** | compose service `db` | — | `:5432` | engine `db.go` (history persist + `/api/history`) |
| **Dashboard** | `econ/dashboard/` | React/Vite | dev `:5188` | engine WS+HTTP |
| **ESP32 node** | `econ/edge/esp32/` / `esp32_node/` | C++/Arduino | — | MQTT broker |
| **YOLO tracker** | `econ/ai_modules/branch_a_occupancy/yolo_bytetrack/yolo_tracker.py` | Python | — | MQTT broker |

All of `db`, `mqtt`, `server` come up together via `econ/server/docker-compose.yml`.

---

## 2. The Go engine (`econ/server/`)

### 2.1 Files
- `main.go` — HTTP routes (`/api/building-data`, `/api/ontology`), the `/ws` upgrade + scenario/override read loop (wrapped in `recover()` so a bad command can never crash the server), and `startMQTT(engine)`.
- `mqtt.go` — paho client: subscribes `econ/telemetry/+`, parses `{"zone","occupancy"}`, calls `engine.SetZoneOccupancy`; sets `engine.Publish` to the MQTT publisher.
- `simulation/engine.go` — the physics engine, occupancy ingestion, actuation optimizer, global-metrics computation, FlatBuffers broadcast.
- `schema/telemetry.fbs` — FlatBuffers IDL (source of truth for the wire format).
- `schema/Telemetry/*.go` — generated Go FlatBuffers code.
- `data/building-data.json`, `data/brick-ontology.json` — building geometry + Brick semantic graph (also copied to `econ/dashboard/src/`).

### 2.2 Engine struct & lifecycle
`simulation.NewEngine()` loads `./data/building-data.json` and builds:
- `Zones map[zoneId]*ZoneSim` — per zone: `Temp, WallTemp, Setpoint, BaseSetpoint, Deadband, Occupancy, BaseHeatGain, SolarGainMult, CAir, CWall, RIn, ROut` plus occupancy-control state `Live, VacantTicks, LightsOn, MqttTopic`.
- `Vavs map[vavId]*VavSim` — `TargetZone, Resistance, Flow, NominalFlow`.
- `Engine.Publish func(topic,payload)` (set by `startMQTT`), `lastCmd map[zoneId]string` (command dedupe), `Scenario, FaultTarget`.

`engine.Start()` runs a 30 fps ticker. Each tick: compute `dt` (accelerated during `fault`/`remediating` for watchable transients) → `tick(dt)` (thermo) → `actuate()` (occupancy optimizer) → `broadcast()` (serialize + send to WS clients).

### 2.3 Physics (`tick`)
2R1C lumped-capacitance per zone. Heat balance:
- `qInternal = BaseHeatGain + Occupancy*100 + SolarGainMult*10000` (×5 on the `FaultTarget` server room during `fault`).
- Cooling is sized against each VAV's **NominalFlow** (captured at init) so a zone holds setpoint at nominal flow regardless of how many VAVs share the AHU — `qNominalTotal = qInternalNominal + steadyStateWall`. **Do not "simplify" this or every zone goes red.**
- Airflow distribution via `doHardyCross()` (fan curve ∩ parallel VAV resistances).

### 2.4 Occupancy ingestion (the occupancy-driven core)
`engine.SetZoneOccupancy(zoneRef, topicSuffix, count)` (called from `mqtt.go`):
- Resolves `zoneRef` to a zone via `resolveZone`: a literal `zoneId`, or `demoZoneAlias` (`zone_1` / `"Level 4"` → `zone-open-a-lvl4`). Extend `demoZoneAlias` to map more CV nodes; in production the payload should carry the real `zoneId`.
- Sets `z.Occupancy = count`, `z.Live = true`, records `z.MqttTopic` so commands route back to the same suffix.
- Once `Live`, the zone uses **real** occupancy for its people-heat load (no more random seed).

### 2.5 Actuation optimizer (`actuate`, every tick)
For each `Live` zone:
- Tracks `VacantTicks`. Vacant = occupancy ≤ 0 for ≥ `vacancyDelayTicks` (90 ≈ 3 s — the report's safety time-delay; raise for production).
- Vacant → `Setpoint = BaseSetpoint + 4°C` (energy-saving setback, lowers cooling load) and `LIGHTS_OFF`. Occupied → restore `BaseSetpoint` and `LIGHTS_ON`.
- Publishes `econ/commands/<zone>` = `LIGHTS_ON|OFF;SETPOINT=<°C>` **only when the command changes** (`lastCmd` dedupe). This is what the ESP32 actuates on.

### 2.6 Global metrics (computed in `broadcast`, all REAL)
Computed each tick from current zone state — these are what the dashboard shows:
- `buildingLoadMW = coolingElectrical + 2.0` base; `coolingElectrical = coolingOutputMW / plantCop`.
- `coolingOutputMW = totalHeatW / 1e6` (thermal cooling delivered).
- `plantCop = clamp(3.6 − 0.35·avgStrain, 2.2, 3.8)` — degrades as zones run hot, so COP/cooling/load are coupled and dynamic.
- `energySavedMW = (Σ lighting-cut + Σ cooling-avoided/COP)/1e6` over zones currently in vacancy setback. 0 when nothing is set back.
- `systemHealth = 100·(zones within deadband)/total`.
- `totalOccupants = Σ Occupancy`.
**Verified dynamic:** injecting a fault drops `plantCop` and `systemHealth`; an MQTT vacancy makes `energySavedMW > 0`.

---

## 3. Wire contract #1 — WebSocket FlatBuffers (engine → dashboard)

Schema `schema/telemetry.fbs` (root `SimState`):
```
ZoneData  { id:string; temp:float; occupants:int; load:float; }
VavData   { id:string; airflow:float; damper:float; }
AhuData   { id:string; supplyTemp:float; pressure:float; status:string; mode:string; }
GlobalData{ buildingLoadMw:float; systemHealth:float; totalOccupants:int;
            coolingOutputMw:float; plantCop:float; energySavedMw:float; }   // last 3 added this session
SimState  { timestamp:long; zones:[ZoneData]; vavs:[VavData]; ahus:[AhuData]; global:GlobalData; }
```
- **Sparse delta**: `broadcast` only re-encodes a zone/vav when its value moved beyond a threshold (`>0.05` temp, `>0.1` flow), with Gaussian sensor noise added — keeps frames small at 30 fps.
- Dashboard reads it in `econ/dashboard/src/useDigitalTwin.js` `onmessage` → updates `simData.zones/vavs` and the `simData.{buildingLoadMw,systemHealth,totalOccupants,coolingOutputMw,plantCop,energySavedMw}` globals, then `globalMetrics` (memo) exposes them to every component. **No fabricated ratios live here anymore.**

### 3.1 HOW TO ADD A NEW STREAMED METRIC (do it this way)
1. Add the field to the **end** of the table in `schema/telemetry.fbs` (end = backward-compatible).
2. Regenerate codecs (host has no `flatc`/`go` — use Docker):
   ```sh
   cd econ/server/schema
   docker run --rm -v "$PWD":/s -w /s neomantra/flatbuffers flatc --go  -o ../        telemetry.fbs   # -> server/schema/Telemetry/*.go
   docker run --rm -v "$PWD":/s -w /s neomantra/flatbuffers flatc --ts  -o ../../../dashboard/src/telemetry telemetry.fbs
   ```
   (Adding 3 floats was small enough that the accessors were hand-added following the exact vtable-offset pattern — offset = `4 + 2*fieldIndex`, builder slot = fieldIndex, and bump `StartObject(n)`. Either approach is fine; regen is the canonical one.)
3. In `engine.go` `broadcast`, compute it and add `Telemetry.GlobalDataAdd<Field>(builder, float32(value))`.
4. In `useDigitalTwin.js` `onmessage`, read `g.<field>()` into `simData`; surface it via `globalMetrics`.
5. Rebuild: `cd econ/server && docker compose up -d --build server` and `cd econ/dashboard && npm run build`.

---

## 4. Wire contract #2 — MQTT (edge ↔ engine)

| Direction | Topic | Payload | Producer | Consumer |
|---|---|---|---|---|
| telemetry IN | `econ/telemetry/<node>` | `{"zone":"...","occupancy":N,"temperature":..,"humidity":..,"co2":..}` | YOLO node / ESP32 | engine `mqtt.go` |
| command OUT | `econ/commands/<zone>` | `LIGHTS_ON\|OFF;SETPOINT=<°C>` | engine `actuate()` / manual override | ESP32 |

- Broker: `eclipse-mosquitto:2`, config `econ/server/mosquitto/mosquitto.conf` (`listener 1883`, `allow_anonymous true`). Harden auth before any real deployment.
- Engine broker address: env `MQTT_BROKER` (`tcp://mqtt:1883` in compose; falls back to `tcp://localhost:1883`). A missing broker NEVER blocks the sim — occupancy just stays simulated.
- Manual override path (DONE): the dashboard `ws.send`s a JSON like `{"action":"LIGHTS_OFF;SETPOINT=26.0","zone":"zone_1"}` (or a high-level verb `purge`/`cool`/`reset`); `main.go` parses it on the `/ws` read loop and calls `engine.PublishCommand`, which normalizes the action to the firmware's `LIGHTS_x;SETPOINT=y` format and publishes it on `econ/commands/<zone>`. Honors the report's human-in-the-loop veto. The override is transient — the occupancy optimizer reasserts control on the next tick (no hold/lock yet).

---

## 5. HTTP endpoints (engine → dashboard bootstrap)
- `GET /api/building-data` → `data/building-data.json` (floors, zones, polygons, hvacMapping, bim_asset_id).
- `GET /api/ontology` → `data/brick-ontology.json` (Brick `brick:feeds` / `brick:hasPoint` graph driving the React-Flow systems map).
- Both set `Access-Control-Allow-Origin: *`.

---

## 6. Build / run / ops (READ THIS — the host has no `go` and no `flatc`)

- **Everything Go is Docker-only.** `go`/`flatc` are not on PATH. To build/run the backend:
  ```sh
  cd econ/server && docker compose up -d --build server      # builds image + starts db, mqtt, server
  ```
- **The image bakes `data/` at build time** (`Dockerfile: COPY data/ ./data/`). Editing `data/*.json` or any `.go` requires `--build`; a plain restart does nothing.
- **Module management** (adding a Go dep) also via Docker:
  ```sh
  cd econ/server && docker run --rm -v "$PWD":/app -w /app golang:1.22 sh -c "go get <mod>@<ver> && go mod tidy"
  ```
  (Pin deps to Go 1.22-compatible versions — e.g. `paho.mqtt.golang v1.4.3`; v1.5+ needs Go 1.24.)
- **Docker Desktop sometimes stops.** If `docker` errors with "cannot connect to the daemon", run `open -ga Docker`, wait ~30–60 s, retry.
- **Dashboard:** preview via `.claude/launch.json` (server name `dashboard`, port 5188, `--prefix econ/dashboard`). Verify in the preview (console must be error-free; screenshot; `eval` to assert values), never by asking the user.

### 6.1 Test the full loop WITHOUT hardware
Mock the CV node with the broker's own clients:
```sh
docker exec server-mqtt-1 mosquitto_sub -t 'econ/commands/#' -v &        # watch actuation
docker exec server-mqtt-1 mosquitto_pub  -t econ/telemetry/zone_1 -m '{"zone":"Level 4","occupancy":0}'
# ~3s later the engine emits: econ/commands/zone_1  LIGHTS_OFF;SETPOINT=26.0
```
The mock payload is byte-identical to `yolo_tracker.py`, so swapping in the real camera is a no-op.

---

## 7. Status

| Area | State |
|---|---|
| Go physics + Hardy Cross + nominal-flow cooling | ✅ implemented, tuned (green baseline) |
| FlatBuffers stream incl. cooling/COP/energySaved | ✅ implemented + verified dynamic |
| MQTT occupancy ingestion → real per-zone occupancy | ✅ implemented + verified |
| Occupancy-driven setback + lighting + edge commands | ✅ implemented + verified (with safety delay) |
| Dashboard reads only real engine values (no hard-coded numbers) | ✅ done (mobile corners, overview, gauges) |
| Mosquitto broker in compose | ✅ |
| Manual override (dashboard → command) | ✅ implemented (`engine.PublishCommand`, §4) |
| TimescaleDB history persistence + `/api/history` | ✅ implemented (`db.go`, batched async writer) |
| YOLO `device=mps` webcam + ByteTrack | ⛔ needs the user's Mac M4 |
| Physical ESP32 flash + relay | ⛔ needs hardware |
| Branch B: PDF/CAD → `building-data.json` digitization | ✅ implemented (CubiCasa5K YOLOv11 + segmenter) |

---

## 8. File map (backend)
```
econ/server/
  main.go                     HTTP routes, /ws loop, startMQTT
  mqtt.go                     MQTT client: telemetry IN, command publisher OUT
  simulation/engine.go        physics, occupancy, actuate(), broadcast(), global metrics
  schema/telemetry.fbs        FlatBuffers IDL (wire format source of truth)
  schema/Telemetry/*.go       generated Go codecs
  mosquitto/mosquitto.conf    broker config (anon, :1883)
  docker-compose.yml          db + mqtt + server
  Dockerfile                  golang:1.22 build; COPY data/ ./data/
  data/building-data.json     geometry/topology (mirrored to dashboard/src/)
  data/brick-ontology.json    Brick semantic graph (mirrored to dashboard/src/)
econ/dashboard/src/
  useDigitalTwin.js           WS decode + globalMetrics (the ONLY place metrics are sourced)
  telemetry/global-data.ts    generated TS reader (mirror of GlobalData)
```
