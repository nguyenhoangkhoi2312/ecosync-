# ECON Enterprise Digital Twin

[![GitHub Repository](https://img.shields.io/badge/GitHub-Repository-blue?logo=github)](https://github.com/nguyenhoangkhoi2312/econ)

ECON is a high-performance Digital Twin platform designed to bridge Building Information Modeling (BIM) data with real-time SCADA/HVAC telemetry. It features a lightweight React/Three.js frontend and a heavy-duty Go backend that runs physical thermodynamic simulations and streams state via WebSockets.

> **🆕 Latest Updates**
>
> ### 2026-06-25 — Digitized building deployed to the live twin
>
> **The real digitized floorplan now drives the twin.** The latest floorplan-digitization output
> (15 floors / 1350 zones) is deployed to both the engine (`server/data/`) and the dashboard
> (`dashboard/src/building-data.json`), so the 3D model and 2D topology render exactly the building
> the Go engine simulates. The engine boots it cleanly and streams live building load (~17.6 MW)
> with per-zone telemetry persisted to TimescaleDB — selecting a zone now shows its real
> temperature/occupancy history sparklines (previously empty whenever the dashboard and engine were
> built from different `building-data.json` copies).
>
> **Topology builder hardened for digitized ontologies.** `buildTopologyFromSim` now normalizes the
> Brick ontology to `{source, target, predicate}`, tolerating both the legacy
> `{ relationships: [...] }` object and the digitization pipeline's flat
> `{subject, predicate, object}` triple array. An `undefined` relationships array from the new
> format had been crashing the desktop dashboard to a black screen.
>
> ### 2026-06-25 — YOLO Integration & Backend Data Lifecycle
>
> **Computer Vision Floorplan Parsing.** The SkeySpot YOLOv11 model weights (`best.pt`, trained on CubiCasa5K) are now integrated into `detector.py`. This allows the platform to natively ingest raw 2D blueprints, detect physical boundaries, and classify bounding boxes for electrical appliances and structural components directly into the semantic ontology.
>
> **Human-in-the-loop veto latching.** Engineered a 15-minute latch (`OverrideUntil`) into the Go Physics Engine. When an operator manually overrides an actuator (e.g. "Lights Off"), the autonomous optimizer respects the veto and suspends automation for 15 minutes instead of instantly re-evaluating the zone state.
>
> **TimescaleDB Continuous Aggregates & Retention.** Upgraded the SQL schema to automatically bucket raw sub-second sensor telemetry into 5-minute averages. Added stringent lifecycle data management: raw high-fidelity telemetry is pruned after 7 days, while 5-minute downsampled historical aggregates are retained for 90 days.
>
> ### 2026-06-24 — TimescaleDB history persistence & manual-override veto
>
> **Self-recording history.** The Go engine now persists its own telemetry to the TimescaleDB
> container once per second — global load/CO₂ and per-zone temperature/occupancy (`server/db.go`).
> Writes go through a non-blocking buffered channel + background batch writer (one multi-row insert
> per flush), so the 30 FPS broadcast loop is never stalled. A new `GET /api/history?zone=&minutes=`
> endpoint serves second-bucketed history (`time_bucket`), and the dashboard seeds its delta-card
> sparklines from it on mount before continuing with the live stream — falling back to the live
> stream alone when the DB container is down.
>
> **Human-in-the-loop override.** Operators can now veto the autonomous optimizer from the dashboard:
> the micro-telemetry and zone panels expose FORCE OFF / MAX COOL / PURGE / RESET buttons that send a
> `{action, zone}` payload over the WebSocket. `main.go` routes it to `Engine.PublishCommand`, which
> normalizes the action (high-level verbs *or* raw firmware strings) to the `LIGHTS_x;SETPOINT=y`
> format the ESP32 and optimizer share, then publishes `econ/commands/<zone>`. The override is
> transient — the occupancy optimizer reasserts control on the next tick.
>
> ### 2026-06-24 — Attention camera, volumetric airflow & forecast wiring
>
> **Attention-floor camera.** Opening the dashboard now frames the *whole tower top-to-bottom*
> centred on the floor that "needs attention" (data-driven `ATTENTION_FLOOR` = the default
> critical asset's floor). Injecting a fault flies the camera straight to the faulting floor.
> Implemented as `towerFraming()` + `DynamicControls` in `dashboard/src/BuildingModel.jsx`.
>
> **Volumetric, layout-constrained airflow (real physics, not particles).** The airflow window
> was a cosmetic particle field; it is now a genuine **masked 3D potential-flow solve** over a
> voxel grid (`flowfield.js` → `flowfield3d.js` → `ConstrainedAirflow3D.jsx`). Air is injected at
> ceiling supply diffusers (strength ∝ live VAV flow), drawn down to low returns near the core,
> relieved at windows, and bent through doorways — **never crossing a wall** (exact no-flux
> Neumann boundary). The solver is documented mathematically in the paper below (§4.4) and in
> [`dashboard/AIRFLOW_AND_CAMERA.md`](dashboard/AIRFLOW_AND_CAMERA.md).
>
> **In-model infrastructure.** The active floor of the main 3D model now renders its real
> physical services — HVAC (AHU → supply ducts → ceiling diffusers → low returns), an electrical
> grid (panel → cable trays → junction boxes), per-zone sensors (camera / thermostat / CO₂), and
> live occupant capsules sized to per-zone occupancy (`dashboard/src/FloorInfrastructure.jsx`),
> all driven by the same `flowfield.js` domain so the model and the airflow window agree.
>
> **DeepFloorplan → airflow bridge.** `floorplan_to_buildingdata.py` now emits a per-floor
> `airflowDomain = { doors, windows }` from detected room adjacency + the building envelope, so a
> digitized blueprint drives the airflow directly; the frontend derives the same domain
> geometrically when it is absent (procedural testbed).
>
> **Forecast ↔ engine wired.** The Go engine exposes `GET /api/forecast` (`server/forecast.go` +
> `Engine.ForecastWindow`), which proxies a live telemetry window `[room_temp, airflow_fraction]`
> to the Python LSTM forecaster and returns its predicted peak cooling load (verified end-to-end:
> `200 {predicted_peak_load: ~2.07, …}`; `503` when the forecaster is down). `FORECAST_URL` wires
> it in `docker-compose.yml`.
>
> ### Earlier
>
> **Occupancy-Driven MQTT Loop.** The Go engine is wired directly to the Mosquitto broker as the
> single brain for both physics and IoT actuation. It subscribes to real telemetry
> (`econ/telemetry/+`), feeds occupancy into the thermal model, and publishes actuation commands
> (`LIGHTS_OFF;SETPOINT=…` to `econ/commands/<zone>`) when zones go vacant past a safety delay. An
> `eclipse-mosquitto` broker was added to `docker-compose.yml`.
>
> **Real metrics — nothing hard-coded.** `GlobalData` now also streams `coolingOutputMw`,
> `plantCop` (a *dynamic* coefficient of performance that degrades with plant strain), and
> `energySavedMw` (from occupancy setback); the engine reads real per-zone occupancy from the
> stream. The dashboard (desktop overview + Tesla-style mobile corners) shows only these
> engine-computed values — the old fabricated solar/grid/COP ratios and random seeds are gone.
> *Verified live:* injecting a fault drops COP and system health; a vacancy makes `energySavedMw` > 0.
>
> **Edge devices, real contract.** The ESP32 firmware now parses the engine's *combined* command
> `LIGHTS_ON|OFF;SETPOINT=<c>` (earlier sketches only matched a literal `"LIGHTS_ON"` and never
> fired) and publishes the telemetry JSON the engine expects. The Raspberry Pi runs an **autonomous
> failsafe gateway** (`edge/raspberry_pi/gateway.py`) — it hosts the broker and only cuts lights
> *when the engine is unreachable* and a zone stays vacant (defers to the engine otherwise),
> replacing the old MQTT↔WebSocket bridge.
>
> **Branch B digitization bridge.** `ai_modules/branch_b_digitization/floorplan_to_buildingdata.py`
> turns a 2D floorplan into the exact `building-data.json` schema the engine + twin consume
> (DeepFloorplan adapter as the upgrade segmenter, OpenCV working today). *Verified:* a real
> floorplan → 15 floors / 210 zones with full thermal properties + HVAC mapping. Note: The classical 
> computer vision pipeline (`cv2.watershed`) was re-engineered to fix severe expansion bugs, but polygon 
> extraction remains highly inaccurate for dense commercial floorplans.
>
> **Hardware-in-the-loop tracking.** Replaced raw static IoT logic with dynamic physical tracking.
> Integrated PyTorch YOLOv11/ByteTrack running on Apple MPS (Metal Performance Shaders) to count
> occupants crossing virtual doorways. Telemetry publishes live to the Go Engine, which routes 
> actuation commands back to a Python ESP32 simulator listening on wildcard MQTT topics.
>
> **WebGL blackout fix.** Every `<Canvas>` is wrapped in an auto-recovering `CanvasErrorBoundary`,
> so a transient render error self-heals instead of permanently blanking the 3D view.

> **📚 Deep specs:** [`BACKEND_ARCHITECTURE.md`](BACKEND_ARCHITECTURE.md) (engine internals, the
> FlatBuffers + MQTT wire contracts, how to add a streamed metric, build/run with no local
> `go`/`flatc`) · [`ai_modules/branch_b_digitization/LAYOUT_SCHEMA.md`](ai_modules/branch_b_digitization/LAYOUT_SCHEMA.md)
> (the building-data schema + DeepFloorplan ingestion) · [`edge/raspberry_pi/README.md`](edge/raspberry_pi/README.md)
> (broker + failsafe setup).

## 🚀 Development Process & Architecture

During **Sprint 1 (Core Architecture & Simulation)**, we built a robust and highly scalable foundation:

1. **High-Performance Telemetry Streaming (Go & FlatBuffers)**
   - Replaced basic JSON polling with a persistent WebSocket connection.
   - Integrated Google FlatBuffers to serialize the simulation state into a compact binary format, allowing the backend to stream building data at a flawless 30 FPS without choking the network or browser memory.

2. **Thermodynamic Physics Engine (Go)**
   - Built a custom simulation engine (`engine.go`) that models thermal mass (`CWall`, `CAir`), thermal resistance (`RIn`, `ROut`), and internal heat loads (people/servers).
   - Implemented a Hardy Cross network solver to calculate dynamic airflow based on VAV damper resistances and AHU pressure.
   - The engine correctly balances external weather, internal heat, and HVAC cooling capacity to reach realistic thermal equilibriums.

3. **3D Visualization Engine (React Three Fiber)**
   - Created a 3D rendering pipeline that dynamically generates multi-story floor plates and thermal zones based on geometric polygons defined in `building-data.json`.
   - Built a custom GLSL Shader using a `smoothstep` heatmap to smoothly and dynamically color the 3D zones based on real-time temperature deviation from the setpoint.

4. **2D P&ID Topology Mapping (React Flow)**
   - Mapped the HVAC systems (AHUs, VAVs, Zones) into an interactive 2D node graph using React Flow.
   - Applied smooth CSS transitions matching the 3D GLSL shader to provide consistent, jitter-free visual feedback across the entire application.

5. **AI Auto-Pilot & Fault Scenarios**
   - Implemented interactive Scenarios (Peak Load, Critical Fault).
   - The "Critical Fault" triggers a 5x thermal runaway in the server room by dynamically throttling VAV airflow.
   - The "AI Auto-Pilot" detects the thermal anomaly and issues a SCADA override script to aggressively route cooling to the core, successfully stabilizing the building.

6. **Advanced Telemetry Analytics & AI Insights**
   - Built a sleek Left Dock Navigation supporting toggleable tabs for **AI Insights** and **Telemetry Logs**.
   - **Dynamic Root Cause Analysis (RCA):** AI Insights accurately diagnoses the fault target, predicting the blast radius and cause (e.g., "CRAC unit compressor failure" for server rooms, "VAV damper stuck" for offices).
   - **Thermodynamic Characteristic Chart:** A real-time auto-scaling Recharts scatter plot showing CO₂ vs Power. The live telemetry dots dynamically follow the ideal thermodynamic slope under normal conditions, but violently break away from the baseline during injected faults to visibly demonstrate anomalies.
   - **Live Terminal Logging:** The Telemetry Logs tab renders a hacker-style real-time terminal of up to 30 active zones, showcasing live temperatures, loads, and occupancy streaming directly from the WASM engine.

7. **Mobile UI Adaptation (Tesla-Style)**
   - Designed a responsive `MobileApp.jsx` interface imitating the Tesla app layout for rapid macro-level facility monitoring.
   - Implemented an immersive top-down isometric camera angle for the 3D map, locking the view from the highest floor down to prevent horizon clipping.
   - Generated and applied a seamless, zero-margin vector sky gradient with a crescent moon, eliminating the hard 2D horizon line to merge perfectly with the 3D viewport's dark background.
   - Built bottom-drawer drill-downs to allow tapping on zones and revealing live telemetry metrics without leaving the 3D map context.

8. **Edge Hardware Integration (ESP32 & Raspberry Pi)**
   - **ESP32 Edge Node (`C++`):** Developed firmware to simulate and publish physical sensor data (PIR/Occupancy, Temp, CO2) over MQTT, and listen for physical actuator commands (Relays, IR emitters).
   - **Raspberry Pi Gateway (`Python`):** Built a local edge server to host the MQTT broker and run local automation logic. E.g., automatically dispatching a `LIGHTS_OFF` MQTT payload back to the ESP32 the moment occupancy drops to 0.
   - **Live WebSocket Feed:** The Raspberry Pi bridges the MQTT hardware layer with a local WebSocket server, streaming physical state directly into the React dashboard.
## 🛠️ How to Run (Detailed Guide)

### Prerequisites
Before starting, ensure you have the following installed on your system:
- **Docker & Docker Compose:** Required to run the Go backend and TimescaleDB containers.
- **Node.js (v18+):** Required to build and run the React/Vite frontend.
- **npm or yarn:** Package manager for Node.js.

### 1. Starting the Backend (Go Simulation Engine)
The backend runs the thermodynamic simulation, serves the building data, and streams WebSocket telemetry.

```bash
# Navigate to the server directory
cd server

# Build and start the Go backend and PostgreSQL database in detached mode
docker-compose up -d --build

# Verify the containers are running
docker ps
# You should see two containers: 'server-server-1' (Port 8080) and 'server-db-1' (Port 5432)

# (Optional) Follow the backend logs to see incoming WebSocket connections
docker logs -f server-server-1
```
*Note: The Go backend runs on `http://localhost:8080`. The WebSocket endpoint is at `ws://localhost:8080/ws`.*

### 2. Starting the Frontend (React Dashboard)
The frontend connects to the local Go backend to render the 3D map and interactive topology.

```bash
# Open a new terminal and navigate to the dashboard directory
# 🚨 CRITICAL: Ensure you are inside the econ/dashboard folder before running this!
cd econ/dashboard

# Install all Node.js dependencies (use --legacy-peer-deps to bypass Three.js peer conflicts)
npm install --legacy-peer-deps

# Start the Vite development server
npm run dev
```

### 3. Accessing the Mobile Dashboard
To allow the frontend server to be accessible from a mobile device on your local network:

**Step 1: Start the Go Backend**
Since the backend sends the live data to your frontend, it needs to be running.
```bash
cd server
docker-compose up -d --build
```

**Step 2: Start the React Frontend with Network Access**
By default, Vite only allows access from the computer it's running on. You need to use the `--host` flag to open it up to your local Wi-Fi network.
```bash
# 🚨 CRITICAL: Make sure you are in the dashboard folder!
cd econ/dashboard
npm install --legacy-peer-deps
npm run dev -- --host
```

**Step 3: Open it on your Mobile Phone**
1. Make sure your mobile phone is connected to the **same Wi-Fi network** as your computer.
2. Look at the terminal where you ran `npm run dev -- --host`. Vite will output something like this:
   ```text
   ➜  Local:   http://localhost:5173/
   ➜  Network: http://192.168.x.x:5173/   <--- Use this one!
   ```
3. Open Safari or Chrome on your phone, and type in that exact **Network URL** (e.g., `http://192.168.1.5:5173`).

The site will load and automatically switch to the `MobileApp` layout because it detects your phone's screen size!

*(Note: You can also simulate the mobile view on your desktop browser by right-clicking -> Inspect and toggling the "Device Emulation" icon).*

### 4. Testing the Backend via CLI Dashboard
For backend testing and telemetry debugging, you can use the standalone Go CLI Dashboard (htop-style).
```bash
# Open a new terminal and navigate to the CLI directory
cd server/cli

# Run the CLI dashboard
go run dashboard.go
```
*Note: The CLI dashboard dynamically sorts the hottest thermal zones to the top of your terminal and natively reads the high-speed FlatBuffers binary stream.*

### 5. Running the Autonomous DeepFloorplan Scanner
The `ai_modules/branch_b_digitization/deepfloorplan` directory contains a Streamlit app to autonomously digitize any architectural blueprint.
```bash
# Navigate to the DeepFloorplan directory
cd ai_modules/branch_b_digitization/deepfloorplan

# Install dependencies (if you haven't already)
pip install streamlit opencv-python networkx

# Run the Streamlit UI
streamlit run app.py
```
*Note: The AI will autonomously grid-search OpenCV parameters to mathematically derive the Space Syntax Dual Graph of the blueprint.*

### 6. Training the YOLOv11 Computer Vision Models
If you wish to retrain the YOLOv11 models (either for Occupancy Detection in Branch A or Floorplan Semantic Segmentation in Branch B) rather than using the pre-trained weights:

```bash
# Navigate to the relevant AI module (e.g., Branch B Digitization)
cd ai_modules/branch_b_digitization/skeyspot

# Ensure Ultralytics is installed
pip install ultralytics

# Start the training job (modify data.yaml and epochs as needed)
# Note on Hardware Acceleration:
# - For Windows/Linux with NVIDIA GPU: append `device=0`
# - For Mac Apple Silicon (M1/M2/M3): append `device=mps`
# - For CPU only: omit the device flag
yolo task=detect mode=train model=yolo11n.pt data=data.yaml epochs=100 imgsz=640 batch=16 device=0
```
*Once training is complete, copy the output weights from `runs/detect/train/weights/best.pt` into the module's root directory before running the tracker.*

### 7. Testing the End-to-End Hardware Integration
To verify the complete physics loop (YOLO -> MQTT -> Go Engine -> ESP32), you can run the mock hardware emulator alongside the computer vision tracker:

**Terminal 1: Start the ESP32 Hardware Emulator**
```bash
cd edge/esp32
python3 esp32_emulator.py
```
*This script subscribes to the `econ/commands/+` MQTT wildcard and listens for thermodynamic actuation triggers (e.g., `LIGHTS_OFF`, `SETPOINT=26.0`).*

**Terminal 2: Start the YOLO Tracker (with local video bypass)**
```bash
cd ai_modules/branch_a_occupancy/yolo_bytetrack
pip install ultralytics opencv-python paho-mqtt
python3 yolo_tracker.py
```
*As YOLO detects people in the sample video, it publishes telemetry to the Go Engine. When the occupancy drops, the Engine mathematically determines the required setback and fires an MQTT actuation command back to Terminal 1, audibly simulating a physical hardware relay click!*

### 8. Testing the Full Digital Twin Functionality
Once the Backend (Step 1) and Frontend (Step 2) are running, open your browser to `http://localhost:5173` to explore the complete feature set:

1. **3D Heatmap & Airflow:** Navigate around the 3D isometric model. The building will glow dynamically based on real-time temperature deviations. The animated airflow lines realistically respect the structural boundaries (walls and doors) based on potential-flow physics.
2. **Fault Injection (AI Auto-Pilot):** On the right-side control panel, click the **Critical Fault** scenario. Watch as the server room experiences a thermal runaway (turning red). The AI Auto-Pilot will autonomously detect the anomaly and aggressively reroute HVAC cooling to stabilize the building.
3. **Telemetry Profiler & Insights:** Open the left navigation dock and select the **Profiler**. Here you can view the live scatter plot showing the building's thermodynamic characteristics (Power vs CO₂). Click on **AI Insights** to see the system autonomously diagnose the root cause of the fault (e.g., "VAV damper stuck").
4. **2D Topology Mapping:** Switch to the **Topology** tab to view the live node-based mechanical graph. You will see the exact dependency chain from the Chiller to the AHU, down to individual VAV boxes and thermal zones.
5. **Manual Veto Overrides:** In the zone details pane, attempt to manually click **FORCE OFF** or **MAX COOL**. The engine will immediately latch your human-in-the-loop override for 15 minutes, superseding the AI's autonomous optimization loop.

### Troubleshooting
- **Frontend isn't receiving data?** Ensure the backend is running and port `8080` is not blocked. Check the browser console (F12) for WebSocket connection errors.
- **Docker port conflict?** If port `8080` or `5432` is already in use by another application on your machine, stop the conflicting application or map different ports in the `docker-compose.yml` file.
---

# ECON: An Occupancy-Aware Digital Twin for Autonomous HVAC Optimization

## Abstract
Traditional Building Management Systems (BMS) operate on rigid, pre-defined schedules, conditioning unoccupied zones and wasting significant energy. We propose **ECON**, a multi-layered Digital Twin that shifts building HVAC and lighting management from schedule-based to demand-based optimization. ECON fuses privacy-preserving edge Computer Vision (YOLOv11 + ByteTrack) for per-zone occupancy, an autonomous floorplan-digitization pipeline (CubiCasa5K-class segmentation) for topology extraction, and a first-principles thermodynamic engine that resolves each zone as an energy-conserving 2R1C circuit coupled through a closed-form duct-network solver. From this physical state ECON derives every dashboard figure — building load, dynamic plant COP, a severity-graded comfort/health score, and occupancy-attributable savings — and visualizes HVAC circulation as a layout-constrained, volumetric potential-flow field. Recent field studies report that occupancy-centric HVAC control commonly yields 10%–20% energy savings, with specific deployments achieving 15.8%–17.6% reductions in HVAC consumption (Bai et al., 2023; Chen et al., 2020). This paper details the mathematical and computational methodologies driving the ECON system; section numbers below reference the implementing source in `econ/server/simulation/engine.go` and `econ/backend/forecasting/`.

---

## 1. Introduction
Commercial office buildings are massive consumers of electricity, with HVAC systems accounting for over 40% of their total energy footprint. Currently, these systems rely on coarse scheduling (e.g., ON at 8:00 AM, OFF at 6:00 PM). This results in "ghost cooling"—the conditioning of empty conference rooms and under-utilized sectors. 

ECON solves this via three key innovations:
1. **Real-Time Occupancy Tracking:** Privacy-preserving edge AI dynamically counts inhabitants per zone.
2. **Automated Topology Digitization:** Deep learning models automatically parse 2D CAD blueprints into 3D structural topologies.
3. **First-Principles Thermodynamic Simulation:** A Go-based engine models real-time thermal mass and airflow to predict required cooling loads.

---

## 2. Edge AI & Occupancy Tracking (Branch A)
To achieve fine-grained control and capture the proven 10-20% energy savings of occupant-centric management, the system must know exactly how many people are in a specific thermal zone.

### 2.1 Privacy-Preserving Object Detection
We utilize **YOLOv11** deployed natively on Edge hardware (Apple Silicon MPS, Raspberry Pi) to run inference on localized camera feeds. To strictly preserve occupant privacy, the architecture adheres to a zero-cloud-video policy: frames are captured via local CSI/USB, processed entirely in volatile RAM during inference, and immediately discarded. The system extracts only scalar telemetry (e.g., `room_id`, `occupancy_count`, `timestamp`), which is published over an MQTT stream.

### 2.2 Tracking-by-Detection (ByteTrack)
To ensure individuals are accurately tracked without double-counting, we employ **ByteTrack** for Multi-Object Tracking ([GitHub Repository](https://github.com/ifzhang/ByteTrack)). 

In dense indoor office environments (e.g., lobbies), simple centroid tracking fails rapidly when people overlap or change scale, leading to identity switches. Conversely, algorithms like DeepSORT ([GitHub Repository](https://github.com/nwojke/deep_sort)) rely heavily on appearance embeddings, which degrade under indoor lighting variations, partial occlusion, or when workers wear visually similar clothing. 

ByteTrack outperforms both by associating *every* detection box — including low-confidence ones — using motion and box-overlap cues. Let the high- and low-confidence detection sets be $\mathcal{D}\_{\text{high}}$ and $\mathcal{D}\_{\text{low}}$. A Kalman filter (Kalman, 1960) first predicts each tracklet's location $\mathcal{T}$ in the current frame; the engine then forms the Intersection-over-Union (IoU) cost matrix between tracklets and high-confidence detections,

$$
C(i, j) = 1 - \text{IoU}\!\left(\mathcal{T}_i,\, \mathcal{D}_j\right),
$$

and solves the optimal assignment with the Hungarian algorithm (Kuhn, 1955). Tracklets left unmatched after this first pass are then associated against $\mathcal{D}\_{\text{low}}$ in a secondary matching pass. This recovers an occupant's identity tracklet when their confidence momentarily drops under partial occlusion, instead of discarding it and double-counting on re-entry.

---

## 3. Autonomous Digital Twin Digitization (Branch B)
Manually mapping the electrical and HVAC topology of a building into a Digital Twin is cost-prohibitive. ECON automates this via a three-step Computer Vision pipeline applied directly to architectural PDFs.

### 3.1 Semantic Room Segmentation
Instead of relying on legacy networks like DeepFloorplan ([GitHub Repository](https://github.com/zlzeng/DeepFloorplan)), ECON utilizes a modern PyTorch implementation based on **CubiCasa5K** ([GitHub Repository](https://github.com/cubicasa/cubicasa5k)) for robust floorplan segmentation. This multi-task backbone accurately extracts wall boundaries and room polygons directly into binary raster masks ($R\_i$), ensuring spatial mapping scales dynamically across various office layouts.

### 3.2 Symbol Detection via Real-World Datasets (CubiCasa5K)
Electrical symbols (lights, VAV boxes, thermostats) and structural boundaries (doors, windows) are isolated using a **YOLOv11** object detector, inspired by approaches like SkeySpot ([GitHub Repository](https://github.com/HAIx-Lab/Skeyspot)). To ensure the model generalizes across diverse architectural drafting styles, it was trained directly on the **CubiCasa5K** dataset (5,000 real-world, high-quality floorplans) rather than purely synthetic data. After 100 epochs of training on Apple Metal Performance Shaders (MPS), the lightweight `yolo11n` network achieved a **69.5% mAP@50** and 73.0% Precision. This high recall rate is critical: it allows the Digital Twin to autonomously digitize the vast majority of physical assets from a flat PDF, while facility engineers only need to manually drag-and-drop the remaining ~30% in the 3D dashboard editor.

### 3.3 Geometry Reconciliation & Graph Output
To automatically connect the detected HVAC/lighting symbols (Section 3.2) to their respective thermal zones (Section 3.1), we implement a geometric overlap algorithm. 

Let each room mask $R\_i$ be a binary region from segmentation, and each detection box $B\_j$ be the symbol bounding box from YOLO. We compute the bounding box center $c\_j$ and calculate the assignment score $s(i,j)$:

$$
s(i,j) = \alpha \cdot \frac{|B_j \cap R_i|}{|B_j|} + (1-\alpha)\cdot \mathbf{1}\!\left[c_j \in R_i\right]
$$

where $0 \le \alpha \le 1$ trades off fractional-overlap against a hard centroid-containment test $\mathbf{1}[\cdot]$. The symbol is assigned to the room

$$
i^{*} = \arg\max_{i}\, s(i,j),
$$

resolving ambiguities when symbols are drafted near doorways or bounding walls.

### 3.4 Space Syntax Topological Analysis
To understand the spatial logic of the digitized rooms without requiring expensive 3D BIM models, ECON calculates the **Closeness Centrality** (Integration Score) of the generated topological graph. The Mean Depth ($MD$) and Integration ($I$) for a room $x$ are calculated as:

$$
MD(x) = \frac{\sum_{y \neq x} d(x, y)}{N - 1}
$$

$$
I(x) = \frac{1}{MD(x)}
$$

Where $d(x, y)$ is the shortest-path topological distance between room $x$ and room $y$, and $N$ is the total number of rooms. This allows the autonomous engine to mathematically determine the "core" zones of the facility. This reconciled geometry is output as a directed JSON graph, seamlessly mapping the physical 2D layout directly into the 3D React Three Fiber frontend.

---

## 4. Thermodynamic Simulation & Forecasting
The core brain of ECON is a continuous physics simulation engine written in Go.

### 4.1 Thermodynamic RC-Network Modeling
The building is modeled as a lumped Resistor–Capacitor (RC) network. The rate of change of the indoor air temperature $T\_z$ in a given zone obeys a first-order energy balance:

$$
C_z \frac{dT_z}{dt} = Q_{\text{HVAC}} + Q_{\text{internal}} + Q_{\text{envelope}} + Q_{\text{solar}}
$$

where

- $C\_z$ — thermal capacitance of the zone air and thermal mass $(\mathrm{J/K})$;
- $Q\_{\text{HVAC}}$ — net sensible cooling/heating power delivered by the VAV terminal $(\mathrm{W}$, negative for cooling$)$;
- $Q\_{\text{internal}}$ — metabolic heat from occupants $(\approx 100\,\mathrm{W}$ per person$)$ plus equipment loads;
- $Q\_{\text{envelope}}$ — conductive/convective transfer through the boundary, $U A\,(T\_{\text{ext}} - T\_z)$;
- $Q\_{\text{solar}}$ — radiative solar gain through fenestration.

To obtain the electrical power drawn by the chiller plant, the sensible cooling duty is divided by the plant Coefficient of Performance (COP):

$$
P_{\text{electrical}} = \frac{|Q_{\text{HVAC}}|}{\text{COP}}
$$

The implementation refines this single-node model into a two-state **2R1C** circuit that separates the fast air node from the slow wall node (§6.1), and the full building electrical load is assembled in §6.6. The engine integrates the resulting ODE system server-side in Go at a fixed $\approx 30\,\mathrm{Hz}$ tick ($\Delta t = 33\,\mathrm{ms}$) and streams the state to the browser as packed FlatBuffers over WebSockets, so the numerical integration never blocks the rendering thread.

### 4.2 Airflow Balancing (Hardy Cross Method)
As Variable Air Volume (VAV) dampers modulate to satisfy local $Q\_{\text{HVAC}}$ demands, the pressure across the building's ductwork shifts. ECON balances the network with the **Hardy Cross method**, whose general loop-flow correction for an arbitrary looped topology is

$$
\Delta Q = -\,\frac{\sum r\,Q\,|Q|^{\,n-1}}{\sum n\,r\,|Q|^{\,n-1}},
$$

with the turbulent-duct exponent $n = 2$. This tunes the Air Handling Unit (AHU) fan to the minimum required static pressure. Because ECON's AHU→VAV layout is a purely parallel star, the network admits a closed-form equivalent-resistance solution rather than iteration; that reduction — the form actually implemented in `engine.go` — is derived in detail in §6.3.

### 4.3 Time-Series Load Forecasting (LSTM)
To transition from reactive cooling to proactive pre-cooling, ECON incorporates a **Long Short-Term Memory (LSTM)** network (Hochreiter & Schmidhuber, 1997). The gated cell state lets the model retain long-range dependencies in weather and occupancy without the vanishing-gradient problem that afflicts vanilla RNNs. At each timestep $t$, with input $x\_t$ and previous hidden state $h\_{t-1}$, the cell computes the forget, input, and output gates and updates its memory $c\_t$:

$$
\begin{aligned}
f_t &= \sigma\!\left(W_f\,[h_{t-1}, x_t] + b_f\right) & \text{(forget gate)}\\
i_t &= \sigma\!\left(W_i\,[h_{t-1}, x_t] + b_i\right) & \text{(input gate)}\\
\tilde{c}_t &= \tanh\!\left(W_c\,[h_{t-1}, x_t] + b_c\right) & \text{(candidate)}\\
c_t &= f_t \odot c_{t-1} + i_t \odot \tilde{c}_t & \text{(cell update)}\\
o_t &= \sigma\!\left(W_o\,[h_{t-1}, x_t] + b_o\right) & \text{(output gate)}\\
h_t &= o_t \odot \tanh(c_t) & \text{(hidden state)}
\end{aligned}
$$

where $\sigma$ is the logistic sigmoid and $\odot$ the Hadamard product. As implemented (`backend/forecasting/model.py`), the network is a 2-layer LSTM with hidden width $64$ over a sequence of $L=12$ timesteps; each timestep is the standardized feature vector

$$
x_t = \big[\,T_{\text{room},t},\; \phi_{\text{flow},t},\; T_{\text{out},t},\; \mathrm{RH}_{\text{out},t}\,\big]
$$

(zone temperature, airflow fraction, outdoor temperature, outdoor humidity). A linear head maps the final hidden state $h\_L$ to the scalar prediction — the building **peak cooling load** in MW:

$$
\hat{P}_{\text{peak}} = W_{\text{out}}\, h_L + b_{\text{out}}.
$$

The model is trained on data synthesized from the engine's own load physics ($P\_{\text{build}} = Q\_{\text{cool}}/\text{COP} + P\_{\text{base}}$, §6.6), reaching a validation MAE of $\approx 0.045\,\mathrm{MW}$. At runtime the Go engine assembles the live $[\,T\_{\text{room}}, \phi\_{\text{flow}}\,]$ window via `Engine.ForecastWindow`, the FastAPI service appends the cached weather features, and the LSTM returns the forecast through `GET /api/forecast`.

### 4.4 Layout-Constrained Airflow (Masked Potential Flow)
Rather than scatter cosmetic particles, ECON solves a **layout-constrained potential-flow field** so the visualized air actually respects walls, doors, diffusers, and returns (`dashboard/src/flowfield3d.js`). Treating the conditioned air as an incompressible, irrotational flow, the velocity is the gradient of a scalar potential $\phi$, and mass conservation with distributed sources reduces to a Poisson equation:

$$
\mathbf{v} = \nabla \phi, \qquad \nabla^2 \phi = S(\mathbf{x}),
$$

where the source term $S$ injects air at ceiling supply diffusers (strength proportional to the live VAV flow of §6.3, amplified on a zone alarm) and withdraws it at the low returns and window relief vents. Solid walls impose a **no-flux Neumann boundary** so air never crosses a partition:

$$
\frac{\partial \phi}{\partial n}\Big|_{\partial\Omega_{\text{wall}}} = 0,
\qquad
\sum_{\mathbf{x}} S(\mathbf{x}) = 0,
$$

the second (net-zero source) condition being the compatibility requirement that makes the pure-Neumann problem solvable. The discretized system is solved over a masked voxel grid (≈ $60\times40\times8$, ceiling supply / floor return / mid-height window relief) with **Gauss–Seidel** relaxation, excluding wall cells from each stencil. Streamlines are then traced for visualization by advecting massless tracers through the trilinearly-sampled field with explicit Euler:

$$
\mathbf{P}_{t+\Delta t} = \mathbf{P}_t + \mathbf{v}(\mathbf{P}_t)\,\Delta t.
$$

The solve is memoized on a coarse key (rounded VAV flow, bucketed occupancy, alarm flips), so it only re-runs when the field meaningfully changes, keeping the rendering interactive. When a digitized blueprint supplies an `airflowDomain` (real door and window positions from Branch B), the solver consumes it directly; otherwise the domain is derived geometrically from shared-edge adjacency and the envelope.

### 4.5 Reinforcement Learning Operations
To fully automate supervisory control, ECON frames building operation as a Markov Decision Process (MDP) $(\mathcal{S}, \mathcal{A}, P, R, \gamma)$, following the occupant-centric building-control RL literature (Wei et al., 2017; Vázquez-Canteli & Nagy, 2019):

- **State $S\_t$** — current zone temperatures, occupancy, dynamic grid prices, and weather forecasts.
- **Action $A\_t$** — HVAC setpoints, pre-cooling activation, and battery dispatch.
- **Reward $R\_t$** — a multi-objective signal penalizing both energy expenditure and thermal discomfort, where the discomfort term grows quadratically with any excursion beyond the comfort deadband $\delta$:

$$
R_t = -\left( \alpha\,\text{EnergyCost}_t + \beta \sum_{z} \big(\max(0,\,|T_z - T_{\text{set}}| - \delta)\big)^2 \right).
$$

The agent maximizes the discounted return $\mathbb{E}\big[\sum\_t \gamma^t R\_t\big]$. The same quadratic-excess discomfort kernel is reused at runtime as the bounded system-health score of §6.5, so the dashboard's live "health" metric is consistent with the objective the policy is trained against.

---

## 5. Software Architecture & Digital Twin UI
To bridge the gap between static architecture and real-time IoT data, ECON implements a highly optimized web architecture.

### 5.1 Semantic Ontologies (Brick Schema)
Rather than parsing raw IFC (Industry Foundation Classes) files—which contain gigabytes of useless geometric data—ECON leverages the **Brick Schema**. Brick is an open-source RDF ontology designed specifically for smart buildings, mapping logical relationships (e.g., `VAV_01 -> brick:feeds -> Zone_A`). By exposing a `/api/ontology` endpoint, the React frontend dynamically renders equipment P&ID diagrams based purely on semantic graph traversal, entirely decoupling the UI from hardcoded topological JSON assumptions.

### 5.2 High-Performance Telemetry Serialization
Traditional REST/JSON pipelines crash browser garbage collectors when attempting to stream 30 FPS telemetry for 135+ zones. ECON solves this by serializing the simulation state into tightly packed binary structs using **Google FlatBuffers** over WebSockets. The React frontend accesses the data directly via byte-offsets (Zero-copy deserialization), achieving flawless 30 FPS rendering on the 3D WebGL heatmaps with negligible memory overhead.

### 5.3 WebGL Rendering Strategy & Optimization
Built using **React Three Fiber**, the platform binds declarative React state (e.g., `selectedZone`) directly to 3D scene updates. A major challenge in mobile WebGL rendering is VRAM exhaustion caused by converting complex geometries to non-indexed formats to generate wireframe `<Edges>`. To prevent `webglcontextlost` crashes on mobile GPUs, ECON implements strict conditional rendering: edges are only computed for the *active* floor and dynamically injected, while the base building relies on cached, indexed Constructive Solid Geometry (CSG). Furthermore, a `CanvasErrorBoundary` intercepts context losses to reload the engine gracefully.

### 5.4 Mobile UX & Spatial Data Binding
Taking design cues from premium interfaces like the Tesla Energy app, the mobile UX prioritizes a top-down isometric 3D view anchored by floating WebGL-to-DOM labels. Data overlays utilize absolute positioning projected from 3D world coordinates to 2D screen space, connected by vertical "drop lines." Using `100dvh` combined with bottom-drawer navigation paradigms ensures the 3D context remains permanently visible without conflicting with iOS Safari's dynamic address bar.

### 5.5 Logical Topology Mapping
While the physical layout is rendered in Three.js, the underlying mechanical lineage (e.g., Chiller $\rightarrow$ AHU $\rightarrow$ VAV box $\rightarrow$ Zone) is rendered using a 2D node-based graph via **ReactFlow**. This duality allows facility managers to debug both spatial problems ("The south perimeter is hot") and mechanical dependencies ("Which VAV serves the south perimeter?"). Thermodynamic characteristic charts (powered by **Recharts**) simultaneously plot CO₂ vs Power to identify mechanical anomalies.

### 5.6 Time-Series Telemetry & Data Lifecycle
To persist the massive influx of simulated and physical telemetry, ECON integrates **TimescaleDB** (a time-series extension for PostgreSQL). The Go engine utilizes non-blocking buffered channels and background batch writers to flush sub-second telemetry without stalling the 30 FPS broadcast loop. To manage long-term storage and prevent database bloat, the schema employs continuous aggregates: raw high-fidelity data is automatically bucketed into 5-minute averages, with raw data strictly pruned after 7 days and downsampled historical aggregates retained for 90 days.

### 5.7 Supervisory Human-in-the-Loop Override (Veto Latching)
While ECON operates as an autonomous system, facility managers must retain supervisory control. Operators can issue direct commands (e.g., `FORCE OFF`, `PURGE`) via the React frontend. These WebSocket payloads are normalized by the Go engine into edge-compatible strings (e.g., `LIGHTS_OFF;SETPOINT=26.0`) and broadcasted via MQTT. Crucially, the engine implements a temporal veto latch (`OverrideUntil`); when a human issues a command, the autonomous occupancy optimizer respects the manual override and suspends its own control loop for 15 minutes, preventing the AI from instantly reversing the operator's decision.

---

## 6. Mathematical Foundations & Physics Engine Rationale

To ensure ECON operates as a deterministic, physical Digital Twin rather than a superficial dashboard, the Go backend (`econ/server/simulation/engine.go`) implements a strict state-space thermodynamic and fluid dynamics model. 

### 6.1 The 2R1C Lumped-Capacitance Thermodynamic Model
While purely data-driven models often fail out-of-distribution during critical HVAC faults or thermal-runaway events, a physical 2-Resistor / 1-Capacitor (2R1C) equivalent-circuit model guarantees first-law (energy-conservation) consistency by construction. Following the simplified RC building-model formulation reviewed by Kramer et al. (2012) and the ASHRAE heat-balance method, each zone resolves transient heat transfer between the outdoor environment, the wall thermal mass ($C\_{\text{wall}}$), and the indoor air volume ($C\_{\text{air}}$) through an inner resistance $R\_{\text{in}}$ (air ↔ wall) and an outer resistance $R\_{\text{out}}$ (wall ↔ outdoors):

$$
\frac{dT_{\text{air}}}{dt} = \frac{1}{C_{\text{air}}} \left[ \frac{T_{\text{wall}} - T_{\text{air}}}{R_{\text{in}}} + \dot{q}_{\text{int}} - \dot{q}_{\text{cool}} \right]
$$

$$
\frac{dT_{\text{wall}}}{dt} = \frac{1}{C_{\text{wall}}} \left[ \frac{T_{\text{out}} - T_{\text{wall}}}{R_{\text{out}}} - \frac{T_{\text{wall}} - T_{\text{air}}}{R_{\text{in}}} \right]
$$

where $\dot{q}\_{\text{int}}$ is the aggregate internal heat load (occupants + equipment + solar gain) and $\dot{q}\_{\text{cool}}$ is the active sensible cooling delivered by the VAV terminal unit (§6.2). Collecting the state $\mathbf{T} = [\,T\_{\text{air}},\, T\_{\text{wall}}\,]^{\top}$, this is a linear state-space system $\dot{\mathbf{T}} = \mathbf{A}\mathbf{T} + \mathbf{b}$ with

$$
\mathbf{A} =
\begin{bmatrix}
-\dfrac{1}{R_{\text{in}}C_{\text{air}}} & \dfrac{1}{R_{\text{in}}C_{\text{air}}} \\
\dfrac{1}{R_{\text{in}}C_{\text{wall}}} & -\dfrac{1}{C_{\text{wall}}}\left(\dfrac{1}{R_{\text{in}}}+\dfrac{1}{R_{\text{out}}}\right)
\end{bmatrix},
\qquad
\mathbf{b} =
\begin{bmatrix}
\dfrac{\dot{q}_{\text{int}} - \dot{q}_{\text{cool}}}{C_{\text{air}}} \\
\dfrac{T_{\text{out}}}{R_{\text{out}}\,C_{\text{wall}}}
\end{bmatrix}.
$$

**Numerical integration & stability.** The engine advances the state with explicit (forward) Euler at each tick (`engine.go`, `z.Temp += dTAirDt * dt`):

$$
\mathbf{T}_{k+1} = (\mathbf{I} + \Delta t\,\mathbf{A})\,\mathbf{T}_k + \Delta t\,\mathbf{b}.
$$

The scheme is numerically stable while the amplification matrix has spectral radius $\rho(\mathbf{I} + \Delta t\,\mathbf{A}) \le 1$. Because the fast air node dominates the eigenvalues, this gives the practical step bound

$$
\Delta t < \frac{2}{|\lambda_{\max}(\mathbf{A})|} \approx 2\,R_{\text{in}} C_{\text{air}} = 2\,\tau_{\text{air}},
$$

i.e. the timestep must stay below twice the smallest zone time constant $\tau\_{\text{air}} = R\_{\text{in}}C\_{\text{air}}$. The base tick $\Delta t = 33\,\mathrm{ms}$ sits far inside this limit; the scenario engine only inflates $\Delta t$ (up to $2.0$) for *visual* fast-forward of recovery, which remains stable given the large zone capacitances ($C\_{\text{air}}, C\_{\text{wall}} \sim 10^{6}\,\mathrm{J/K}$).

### 6.2 HVAC Cooling Capacity & Nominal Flow Normalization
To prevent thermal drift across unequally-sized zones, the engine sizes each zone's cooling capacity against its VAV's *nominal* design flow, so that at nominal flow and setpoint the zone is in exact steady-state balance:

$$
\dot{q}_{\text{cool}} = \underbrace{\frac{\dot{m}}{\dot{m}_{\text{nom}}}}_{\text{flow ratio}} \cdot\; \dot{q}_{\text{total,nom}} \cdot \underbrace{\frac{T_{\text{air}} - T_{\text{supply}}}{T_{\text{sp}} - T_{\text{supply}}}}_{\text{thermal driving ratio}},
\qquad T_{\text{supply}} = 12\,^{\circ}\mathrm{C},
$$

where $\dot{m}$ is the live VAV mass-airflow, $\dot{m}\_{\text{nom}}$ its nominal value (captured once from the Hardy-Cross solve at default damper resistance, §6.3), and $T\_{\text{supply}} = 12\,^{\circ}\mathrm{C}$ is the conditioned supply-air temperature. The nominal total load that must be removed to hold setpoint is the sum of the nominal internal gains and the steady-state envelope conduction:

$$
\dot{q}_{\text{total,nom}} = \dot{q}_{\text{int,nom}} + \frac{T_{\text{out}} - T_{\text{sp}}}{R_{\text{in}} + R_{\text{out}}}.
$$

Normalizing by each VAV's own nominal flow (rather than a hard-coded reference) keeps the model correct regardless of how many VAVs share an AHU. Consequently any airflow reduction ($\dot{m} < \dot{m}\_{\text{nom}}$) — whether from an occupancy setback or a stuck damper — produces an immediate, physically-grounded drop in cooling capacity, driving the $T\_{\text{air}}$ equation of §6.1 into a warming state.

### 6.3 Hardy Cross Fluid Network Solver
When a VAV damper closes (from a fault or an occupancy-driven setback), the static pressure in the shared ductwork shifts, inherently forcing more airflow into the parallel zones. Each duct branch obeys the turbulent head-loss law

$$
h = K\,Q^{2} \quad (\text{exponent } n = 2),
$$

so the loop residual is non-linear in flow. The classical **Hardy Cross method** (Cross, 1936) solves a looped network by iteratively applying the flow correction that drives each loop's net head loss to zero — a Newton step on the loop residual:

$$
\Delta Q = -\,\frac{\sum K\,Q\,|Q|}{\sum 2K\,|Q|}.
$$

For ECON's topology — $V$ VAV branches in **parallel** between a common AHU plenum and the return — the network reduces to a single node, so the engine solves the equivalent system in closed form rather than looping (`doHardyCross`). At a common plenum-to-return pressure drop $\Delta P$, each branch carries $Q\_v = \sqrt{\Delta P / K\_v}$; summing and inverting gives the equivalent system resistance

$$
K_{\text{sys}} = \left( \sum_{v=1}^{V} K_v^{-1/2} \right)^{-2}.
$$

The AHU fan supplies a fixed pressure budget $P\_{\max}$ split between the fan curve coefficient $K\_{\text{fan}}$ and the network, fixing the total flow and the operating pressure:

$$
Q_{\text{tot}}^{2} = \frac{P_{\max}}{K_{\text{fan}} + K_{\text{sys}}},
\qquad
\Delta P = K_{\text{sys}}\,Q_{\text{tot}}^{2},
\qquad
Q_v = \sqrt{\frac{\Delta P}{K_v}}.
$$

This equivalent-resistance reduction is exact for the parallel star (no iteration needed), while the iterative form above remains available for genuinely looped duct topologies. Solving the network dynamically — rather than assuming static per-VAV flows — lets the AI Auto-Pilot train against the realistic, cascading aerodynamic consequences (a closing damper raising $K\_{\text{sys}}$ and redistributing flow to its neighbours) that occur during peak load or mechanical failure.

### 6.4 Dynamic Coefficient of Performance (COP) Degradation
The chiller plant's efficiency is not static: as zones drift above setpoint the chillers run at higher lift, so the plant COP degrades with thermal **strain**. We define the strain as the mean per-zone over-setpoint excess (clamped at zero, so well-conditioned zones contribute nothing):

$$
\text{Strain} = \frac{1}{N}\sum_{z=1}^{N} \max\!\left(0,\; T_z - T_{\text{sp},z}\right),
$$

and the plant COP follows an empirical, bounded degradation curve:

$$
\text{COP} = \max\!\Big(2.2,\; \min\!\big(3.8,\; 3.6 - 0.35\cdot\text{Strain}\big)\Big).
$$

This couples the thermodynamic state to the electrical state, so a thermal fault both degrades overall system health and spikes the `buildingLoadMw` metric broadcast to the dashboard.

### 6.5 Bounded Thermal-Comfort & System-Health Score
The dashboard's single "system health" figure is not an ad-hoc heuristic but a direct, bounded mapping of the same discomfort kernel that the RL reward of §4.5 penalizes. For each zone we measure the excess excursion *beyond* its comfort deadband $\delta$,

$$
e_z = \max\!\left(0,\; |T_z - T_{\text{sp},z}| - \delta\right),
$$

and convert it into a per-zone comfort score with a Lorentzian (Cauchy) kernel of half-width $\sigma = 2.5\,^{\circ}\mathrm{C}$, which scores $1$ in-band and decays smoothly toward $0$ as a zone runs away:

$$
c_z = \frac{1}{1 + e_z^{2}/\sigma^{2}} \in (0, 1].
$$

The broadcast system health is the mean comfort across all zones, expressed as a percentage:

$$
H = \frac{100}{N}\sum_{z=1}^{N} c_z.
$$

This grades the building by *severity* — a $0.1\,^{\circ}\mathrm{C}$ overshoot reads as essentially healthy while a runaway collapses toward $0$ — replacing the earlier binary in-band/out-of-band flag, while a separate discrete count of alarmed zones drives the hard fault indicators.

### 6.6 Building Electrical-Load Decomposition & Occupancy Savings
The total electrical demand streamed to the dashboard is assembled from the thermodynamic state and the dynamic COP of §6.4. Aggregating the sensible cooling delivered to every zone gives the plant's thermal duty $Q\_{\text{cool}} = \sum\_z \dot q\_{\text{int},z}$ (MW-thermal); dividing by the COP yields the chiller electrical draw, to which a fixed non-cooling baseline $P\_{\text{base}} = 2.0\,\mathrm{MW}$ (lighting, plug, and fan loads) is added:

$$
P_{\text{build}} = \frac{Q_{\text{cool}}}{\text{COP}} + P_{\text{base}}.
$$

The occupancy optimizer's benefit is quantified explicitly. For every *live* zone currently in setback (lights off, setpoint raised) the engine credits the avoided lighting load and the avoided fraction of internal-gain cooling:

$$
P_{\text{saved}} = \frac{1}{10^{6}}\sum_{z \in \mathcal{Z}_{\text{setback}}}\left( P_{\text{light},z} + \frac{0.25\,\dot q_{\text{base},z}}{\text{COP}} \right) \quad [\mathrm{MW}],
$$

with $P\_{\text{light},z} = 2\,\mathrm{kW}$ per zone. This is the `energySavedMw` figure on the dashboard — a directly-attributable, occupancy-driven saving rather than a modeled estimate. Finally, the broadcast telemetry is perturbed by additive Gaussian sensor noise $\varepsilon \sim \mathcal{N}(0, \sigma\_s^2)$, generated via the Box–Muller transform, so the live charts exhibit realistic measurement jitter without affecting the underlying physics state.

---

## 7. Conclusion & Novel Contributions
ECON merges physical 3D space, logical 2D topology, and a first-principles thermodynamic engine into a single occupancy-aware Digital Twin. Its specific contributions are:

1. **An energy-conserving 2R1C engine with normalized cooling and a closed-form duct solver** (§6.1–6.3) that stays physically valid out-of-distribution — during faults and thermal runaway — where data-driven surrogates fail.
2. **A severity-graded comfort/health model** (§6.5) that derives the dashboard's live health metric from the very same quadratic-excess discomfort kernel the RL policy is trained against (§4.5), keeping monitoring and control objectives consistent.
3. **A layout-constrained, volumetric potential-flow airflow field** (§4.4) — masked Poisson solve with exact no-flux walls and balanced supply/return sources — that visualizes HVAC circulation which respects the real floor geometry, driven directly by the Branch B digitization output.
4. **An end-to-end occupancy loop**: edge CV (YOLOv11 + ByteTrack) → MQTT → Go optimizer → ESP32 actuation, with an LSTM peak-load forecaster wired in over `GET /api/forecast`.

By proving that a complex WebGL twin can run on mobile GPUs through aggressive geometry culling, and by computing every dashboard figure from real engine state rather than fabricated constants, ECON extends the Digital Twin beyond the stationary control room. Real-world field testing of occupancy-presence sensing has validated up to **17.6%** HVAC energy savings (Bai et al., 2023; Chen et al., 2020); ECON provides a scalable, reinforcement-learning-driven pathway to those high-yield 10–20% ESG energy-reduction targets without compromising occupant comfort.

---

## 8. References

### Occupancy-Centric HVAC & Energy Savings
1. Bai, Z., et al. (2023). *Long-term field testing of the accuracy and HVAC energy savings potential of occupancy presence sensors in a single-family home*. U.S. Department of Energy, OSTI.
2. Chen, Y., Hong, T., & Luo, X. (2020). *Nationwide HVAC energy-saving potential quantification for office buildings with occupant-centric controls in various climates*. Applied Energy, 269, 115103.
3. Akhtar, T., Mahmood, A., & Khatoon, S. (2024). *Occupancy detection for HVAC systems using IoT edge computing and vision-based image processing*. University of East London.
4. Abade, A., et al. (2021). *Quantifying the nationwide HVAC energy savings in large hotels: the role of occupant-centric controls*. Energy and Buildings.
5. Louisiana State University Repository. (2023). *Field testing of the energy-saving potential of an occupancy presence sensing system in an apartment unit*.

### Computer Vision: Detection, Tracking & Floorplan Analysis
6. Redmon, J., Divvala, S., Girshick, R., & Farhadi, A. (2016). *You Only Look Once: Unified, real-time object detection*. CVPR 2016. (YOLO family; YOLOv11 via Ultralytics, 2024.)
7. Zhang, Y., et al. (2022). *ByteTrack: Multi-Object Tracking by Associating Every Detection Box*. ECCV 2022. [GitHub: ifzhang/ByteTrack](https://github.com/ifzhang/ByteTrack)
8. Wojke, N., Bewley, A., & Paulus, D. (2017). *Simple online and realtime tracking with a deep association metric (DeepSORT)*. ICIP 2017. [GitHub: nwojke/deep_sort](https://github.com/nwojke/deep_sort)
9. Kalman, R. E. (1960). *A new approach to linear filtering and prediction problems*. Journal of Basic Engineering, 82(1), 35–45.
10. Kuhn, H. W. (1955). *The Hungarian method for the assignment problem*. Naval Research Logistics Quarterly, 2(1–2), 83–97.
11. Kalervo, A., et al. (2019). *CubiCasa5K: A dataset and an improved multi-task model for floorplan image analysis*. SCIA 2019. [GitHub: cubicasa/cubicasa5k](https://github.com/cubicasa/cubicasa5k)
12. Zeng, Z., et al. (2019). *DeepFloorplan: Deep multi-task floorplan recognition*. ICCV 2019. [GitHub: zlzeng/DeepFloorplan](https://github.com/zlzeng/DeepFloorplan)
13. HAIx Lab. (2025). *SkeySpot: Automating service-key detection for digital electrical layout plans in the construction industry*. IEEE SMC 2025. [GitHub: HAIx-Lab/Skeyspot](https://github.com/HAIx-Lab/Skeyspot)

### Thermodynamics, Fluid Networks & Forecasting
14. Kramer, R., van Schijndel, A., & Schellen, H. (2012). *Simplified thermal and hygric building models: A literature review*. Frontiers of Architectural Research, 1(4), 318–325.
15. ASHRAE. (2021). *ASHRAE Handbook — Fundamentals* (Ch. 18, Nonresidential Cooling and Heating Load Calculations; heat-balance method). ASHRAE, Atlanta.
16. Braun, J. E. (1990). *Reducing energy costs and peak electrical demand through building thermal mass*. ASHRAE Transactions, 96(2), 870–888.
17. Cross, H. (1936). *Analysis of flow in networks of conduits or conductors*. University of Illinois Engineering Experiment Station, Bulletin 286.
18. Hochreiter, S., & Schmidhuber, J. (1997). *Long short-term memory*. Neural Computation, 9(8), 1735–1780.
19. Stam, J. (1999). *Stable fluids*. SIGGRAPH 1999, 121–128. (Reference for the planned advection–diffusion upgrade of §4.4.)
20. Box, G. E. P., & Muller, M. E. (1958). *A note on the generation of random normal deviates*. Annals of Mathematical Statistics, 29(2), 610–611.

### Reinforcement Learning & Semantic Building Models
21. Wei, T., Wang, Y., & Zhu, Q. (2017). *Deep reinforcement learning for building HVAC control*. DAC 2017.
22. Vázquez-Canteli, J. R., & Nagy, Z. (2019). *Reinforcement learning for demand response: A review of algorithms and modeling techniques*. Applied Energy, 235, 1072–1089. (CityLearn.)
23. Balaji, B., et al. (2016). *Brick: Towards a unified metadata schema for buildings*. BuildSys 2016, 41–50.
24. Hillier, B., & Hanson, J. (1984). *The Social Logic of Space*. Cambridge University Press. (Space-syntax integration / closeness centrality.)
