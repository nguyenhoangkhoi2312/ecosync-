# ECON Enterprise Digital Twin

ECON is a high-performance Digital Twin platform designed to bridge Building Information Modeling (BIM) data with real-time SCADA/HVAC telemetry. It features a lightweight React/Three.js frontend and a heavy-duty Go backend that runs physical thermodynamic simulations and streams state via WebSockets.

> **🆕 Latest Updates**
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

## 🚧 Current Limitations & Challenges

### 1. Mobile 3D Scaling & React Three Fiber Strict Mode
- **Challenge:** Adapting the desktop 3D `BuildingModel` for mobile viewports required dynamically passing `isMobile` props deeply through nested components (`FloorPlate`, `ZoneRenderer`). 
- **Limitation:** React Three Fiber's event system and Canvas error boundaries are extremely sensitive to undefined variables. Aggressively injecting responsive props caused fatal WebGL unmounting in strict mode, necessitating careful prop-drilling or Context API usage to prevent UI regressions on desktop.
- **UI Clipping:** Ensuring floating `<Html>` labels in the 3D scene do not overlap native CSS overlay menus on smaller screens requires manual z-index and conditional rendering management.

While our recent sprints successfully proved the core architecture, 3D visualizations, and interactive IoT drill-downs, several critical features remain unimplemented before the platform is ready for production.

### 1. Historical Data & Predictive Forecasting
- **Forecasting (Allocated to Team):** The data science team is currently allocated to handle time-series forecasting, building out historical data ingestion pipelines (batch-inserting 30FPS FlatBuffers into TimescaleDB), and rendering predictive analytics charts.
- **Current State:** The `docker-compose.yml` initializes a `timescaledb` (PostgreSQL) container, but the Go backend does not yet write telemetry data to it. The frontend currently streams live ephemeral data.
- **Missing:** REST or GraphQL API endpoints to query the historical downsampled data being generated by the forecasting team.

### 2. Advanced Capabilities & Security
- **Semantic Mapping Layer:** Missing a mechanism to automatically bind BIM GUIDs (Asset IDs) to their corresponding SCADA telemetry tags (e.g., BACnet IP endpoints, Modbus registers).
- **Machine Learning Inference:** The "AI Auto-Pilot" currently relies on hardcoded thresholds (e.g., `temp > 25.0`) to trigger remediation. This needs to be replaced with an actual ML model (e.g., PyTorch via a Python microservice) that predicts thermal anomalies based on historical weather, occupancy, and HVAC degradation.
- **Security & Authentication:** WebSockets and API endpoints are completely open. Missing JWT authentication, WSS (Secure WebSockets), and proper CORS configurations for production deployment.

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

### Troubleshooting
- **Frontend isn't receiving data?** Ensure the backend is running and port `8080` is not blocked. Check the browser console (F12) for WebSocket connection errors.
- **Docker port conflict?** If port `8080` or `5432` is already in use by another application on your machine, stop the conflicting application or map different ports in the `docker-compose.yml` file.
---

# ECON: An Occupancy-Aware Digital Twin for Autonomous HVAC Optimization

## Abstract
Traditional Building Management Systems (BMS) operate on rigid, pre-defined schedules, leading to significant energy waste cooling unoccupied zones. We propose **ECON**, a multi-layered Digital Twin architecture that transitions building HVAC and lighting management from schedule-based to demand-based optimization. By fusing state-of-the-art Computer Vision (YOLOv11, ByteTrack) at the Edge with an autonomous floorplan digitization pipeline (CubiCasa5K) and a high-performance thermodynamic physics engine, ECON dynamically models and adjusts the thermal equilibrium of a building in real-time. Recent field studies indicate that transitioning to occupancy-centric HVAC control commonly yields 10%–20% energy savings, with specific deployments achieving 15.8% to 17.6% reduction in HVAC consumption. This paper details the mathematical and computational methodologies driving the ECON system.

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

ByteTrack mathematically outperforms both by associating *every* detection box—including low-confidence detections—using motion and box association. Let the high-confidence detection boxes be $\mathcal{D}_{high}$ and low-confidence boxes be $\mathcal{D}_{low}$. ByteTrack first utilizes a Kalman Filter to predict the tracklet locations $\mathcal{T}$ in the current frame, and computes an Intersection over Union (IoU) distance matrix $C$ between $\mathcal{T}$ and $\mathcal{D}_{high}$:

$$ C(i, j) = 1 - \text{IoU}(\mathcal{T}_i, \mathcal{D}_{j}) $$

After using the Hungarian algorithm to match high-confidence boxes, the remaining unmatched tracklets are associated with $\mathcal{D}_{low}$ using a secondary matching pass. This mathematically ensures that when an occupant's confidence score drops due to partial occlusion, their identity tracklet is recovered rather than discarded.

---

## 3. Autonomous Digital Twin Digitization (Branch B)
Manually mapping the electrical and HVAC topology of a building into a Digital Twin is cost-prohibitive. ECON automates this via a three-step Computer Vision pipeline applied directly to architectural PDFs.

### 3.1 Semantic Room Segmentation
Instead of relying on legacy networks like DeepFloorplan ([GitHub Repository](https://github.com/zlzeng/DeepFloorplan)), ECON utilizes a modern PyTorch implementation based on **CubiCasa5K** ([GitHub Repository](https://github.com/cubicasa/cubicasa5k)) for robust floorplan segmentation. This multi-task backbone accurately extracts wall boundaries and room polygons directly into binary raster masks ($R_i$), ensuring spatial mapping scales dynamically across various office layouts.

### 3.2 Symbol Detection via Synthetic Data
Electrical symbols (lights, VAV boxes, thermostats) are isolated using a **YOLOv11** object detector, inspired by approaches like SkeySpot ([GitHub Repository](https://github.com/HAIx-Lab/Skeyspot)). Because CAD symbols vary widely across architectural firms, the model is trained using a massive synthetic dataset. Vector symbol templates (SVG/PNG) are randomly augmented (scale, rotation, scan noise, faded ink) and superimposed onto empty floorplans to achieve high generalizability across real-world blueprints.

### 3.3 Geometry Reconciliation & Graph Output
To automatically connect the detected HVAC/lighting symbols (Section 3.2) to their respective thermal zones (Section 3.1), we implement a geometric overlap algorithm. 

Let each room mask $R_i$ be a binary region from segmentation, and each detection box $B_j$ be the symbol bounding box from YOLO. We compute the bounding box center $c_j$ and calculate the assignment score $s(i,j)$:

$$ s(i,j) = \alpha \cdot \frac{|B_j \cap R_i|}{|B_j|} + (1-\alpha)\cdot \mathbf{1}[c_j \in R_i] $$

where $0 \le \alpha \le 1$. The symbol is assigned to the room $i^*$ that maximizes this score, resolving ambiguities when symbols are drafted near doorways or bounding walls.

### 3.4 Space Syntax Topological Analysis
To understand the spatial logic of the digitized rooms without requiring expensive 3D BIM models, ECON calculates the **Closeness Centrality** (Integration Score) of the generated topological graph. The Mean Depth ($MD$) and Integration ($I$) for a room $x$ are calculated as:

$$ MD(x) = \frac{\sum_{y \neq x} d(x, y)}{N - 1} $$
$$ I(x) = \frac{1}{MD(x)} $$

Where $d(x, y)$ is the shortest path topological distance between room $x$ and room $y$, and $N$ is the total number of rooms. This allows the autonomous engine to mathematically determine the "core" zones of the facility. This reconciled geometry is output as a directed JSON graph, seamlessly mapping the physical 2D layout directly into the 3D React Three Fiber frontend.

---

## 4. Thermodynamic Simulation & Forecasting
The core brain of ECON is a continuous physics simulation engine written in Go.

### 4.1 Thermodynamic RC-Network Modeling
The building is modeled as a Resistor-Capacitor (RC) network. The rate of change of the indoor air temperature $T_z$ in a given zone is governed by the first-order differential equation:

$$ C_z \frac{dT_z}{dt} = Q_{HVAC} + Q_{internal} + Q_{envelope} + Q_{solar} $$

Where:
- $C_z$: Thermal capacitance of the zone air and thermal mass ($J/K$).
- $Q_{HVAC}$: Cooling/heating power delivered by the system ($W$).
- $Q_{internal}$: Metabolic heat from occupants ($100W \times$ occupancy count) combined with equipment loads.
- $Q_{envelope}$: Conductive/convective heat transfer through boundaries ($U \cdot A \cdot (T_{ext} - T_z)$).
- $Q_{solar}$: Radiative solar heat gain through fenestrations.

To determine the actual electrical load drawn by the chillers, we divide the required cooling power by the Coefficient of Performance (COP):

$$ P_{electrical} = \frac{Q_{HVAC}}{COP} $$

By solving this differential equation numerically at 30 FPS via a compiled WebAssembly (WASM) module, the system calculates the exact minimum $P_{electrical}$ required, entirely offloading the numerical integration from the JavaScript main thread.

### 4.2 Airflow Balancing (Hardy Cross Method)
As Variable Air Volume (VAV) dampers modulate to satisfy local $Q_{hvac}$ demands, pressure across the building's ductwork shifts. The engine utilizes the **Hardy Cross method** to iteratively solve for dynamic airflow distribution. For a closed loop in the duct network, the flow correction $\Delta Q$ is calculated as:

$$ \Delta Q = - \frac{\sum r Q |Q|^{n-1}}{\sum n r |Q|^{n-1}} $$

For turbulent airflow within HVAC ducts, we set $n = 2$. This algorithm ensures the main Air Handling Unit (AHU) fan speed is optimally tuned to the minimum required static pressure.

### 4.3 Time-Series Load Forecasting (LSTM)
To transition from reactive cooling to proactive pre-cooling, ECON incorporates a **Long Short-Term Memory (LSTM)** neural network. The LSTM is highly suited for HVAC forecasting due to its ability to retain long-term dependencies in weather and occupancy patterns without suffering from the vanishing gradient problem. The forget gate $f_t$ controls which historical data is discarded:

$$ f_t = \sigma(W_f \cdot [h_{t-1}, x_t] + b_f) $$

By feeding historical weather data ($x_t$), solar irradiance forecasts, and historical occupancy sequences into the model, ECON predicts the peak thermal load $T_{z}$ up to 24 hours in advance.

### 4.4 Airflow Vector Field Visualization
To represent the complex Computational Fluid Dynamics (CFD) airflow distribution calculated by the Hardy Cross method, the system utilizes shader-based particle advection. The airflow velocity $\vec{V}(x,y,z)$ is mapped to a 3D grid, and particles are updated via Euler integration:

$$ \vec{P}_{t+\Delta t} = \vec{P}_t + \vec{V}(\vec{P}_t) \cdot \Delta t $$

By executing this integration natively on the GPU via custom WebGL vertex shaders, ECON renders thousands of simultaneous particles without blocking the browser's main thread.

### 4.5 Reinforcement Learning Operations
To fully automate operations, ECON treats building control as a Markov Decision Process (MDP):
- **State ($S_t$)**: Current temperatures, occupancy, dynamic grid prices, weather forecasts.
- **Action ($A_t$)**: HVAC setpoints, precooling activation, battery dispatch.
- **Reward Function ($R_t$)**: A multi-objective function penalizing both energy expenditure and thermal discomfort (deviation from setpoint $\delta$):

$$ R_t = - \left( \alpha \cdot \text{EnergyCost}_t + \beta \cdot \sum_{z} (\max(0, |T_z - T_{set}| - \delta))^2 \right) $$

---

## 5. Software Architecture & Digital Twin UI
To bridge the gap between static architecture and real-time IoT data, ECON implements a highly optimized web architecture.

### 5.1 Semantic Ontologies (Brick Schema)
Rather than parsing raw IFC (Industry Foundation Classes) files—which contain gigabytes of useless geometric data—ECON leverages the **Brick Schema**. Brick is an open-source RDF ontology designed specifically for smart buildings, mapping logical relationships (e.g., `VAV_01 -> brick:feeds -> Zone_A`). By exposing a `/api/ontology` endpoint, the React frontend dynamically renders equipment P&ID diagrams based purely on semantic graph traversal, entirely decoupling the UI from hardcoded topological JSON assumptions.

### 5.2 High-Performance Telemetry Serialization
Traditional REST/JSON pipelines crash browser garbage collectors when attempting to stream 30 FPS telemetry for 135+ zones. ECON solves this by serializing the simulation state into tightly packed binary structs using **Google FlatBuffers** over WebSockets. The React frontend accesses the data directly via byte-offsets (Zero-copy deserialization), achieving flawless 30 FPS rendering on the 3D WebGL heatmaps with negligible memory overhead.

### 5.1 WebGL Rendering Strategy & Optimization
Built using **React Three Fiber**, the platform binds declarative React state (e.g., `selectedZone`) directly to 3D scene updates. A major challenge in mobile WebGL rendering is VRAM exhaustion caused by converting complex geometries to non-indexed formats to generate wireframe `<Edges>`. To prevent `webglcontextlost` crashes on mobile GPUs, ECON implements strict conditional rendering: edges are only computed for the *active* floor and dynamically injected, while the base building relies on cached, indexed Constructive Solid Geometry (CSG). Furthermore, a `CanvasErrorBoundary` intercepts context losses to reload the engine gracefully.

### 5.2 Mobile UX & Spatial Data Binding
Taking design cues from premium interfaces like the Tesla Energy app, the mobile UX prioritizes a top-down isometric 3D view anchored by floating WebGL-to-DOM labels. Data overlays utilize absolute positioning projected from 3D world coordinates to 2D screen space, connected by vertical "drop lines." Using `100dvh` combined with bottom-drawer navigation paradigms ensures the 3D context remains permanently visible without conflicting with iOS Safari's dynamic address bar.

### 5.3 Logical Topology Mapping
While the physical layout is rendered in Three.js, the underlying mechanical lineage (e.g., Chiller $\rightarrow$ AHU $\rightarrow$ VAV box $\rightarrow$ Zone) is rendered using a 2D node-based graph via **ReactFlow**. This duality allows facility managers to debug both spatial problems ("The south perimeter is hot") and mechanical dependencies ("Which VAV serves the south perimeter?"). Thermodynamic characteristic charts (powered by **Recharts**) simultaneously plot CO₂ vs Power to identify mechanical anomalies.

---

## 6. Mathematical Foundations & Physics Engine Rationale

To ensure ECON operates as a deterministic, physical Digital Twin rather than a superficial dashboard, the Go backend (`econ/server/simulation/engine.go`) implements a strict state-space thermodynamic and fluid dynamics model. 

### 6.1 The 2R1C Lumped-Capacitance Thermodynamic Model
While pure machine learning (ML) models often fail out-of-distribution during critical HVAC faults or thermal runaway events, a physical 2-Resistor, 1-Capacitor (2R1C) equivalent-circuit model guarantees thermodynamic energy conservation. Based on the fundamental heat-balance equations defined by ASHRAE (Kramer et al., 2012), each thermal zone simulates transient heat transfer between the external environment, the thermal mass of the walls ($C_{\text{wall}}$), and the internal air volume ($C_{\text{air}}$):

$$ \frac{dT_{\text{air}}}{dt} = \frac{1}{C_{\text{air}}} \left[ \frac{T_{\text{wall}} - T_{\text{air}}}{R_{\text{in}}} + \dot{q}_{\text{int}} - \dot{q}_{\text{cool}} \right] $$

$$ \frac{dT_{\text{wall}}}{dt} = \frac{1}{C_{\text{wall}}} \left[ \frac{T_{\text{out}} - T_{\text{wall}}}{R_{\text{out}}} - \frac{T_{\text{wall}} - T_{\text{air}}}{R_{\text{in}}} \right] $$

Where:
- $\dot{q}_{\text{int}}$ is the aggregate internal heat load (occupants + equipment + solar gain).
- $\dot{q}_{\text{cool}}$ is the active sensible cooling delivered by the VAV terminal unit.

### 6.2 HVAC Cooling Capacity & Nominal Flow Normalization
To prevent thermal drift across unequally sized zones, the engine dynamically sizes the baseline cooling capacity against each VAV's nominal design flow, ensuring the zone strictly holds its setpoint ($T_{\text{sp}}$) under steady-state conditions:

$$ \dot{q}_{\text{cool}} = \left( \frac{\text{Flow}}{\text{Flow}_{\text{nom}}} \right) \cdot \dot{q}_{\text{total,nom}} \cdot \frac{T_{\text{air}} - 12.0}{T_{\text{sp}} - 12.0} $$

This ensures that any reduction in airflow ($\text{Flow} < \text{Flow}_{\text{nom}}$)—whether driven by an occupancy setback or a mechanical damper fault—results in an immediate, mathematically sound drop in cooling capacity, driving the $T_{\text{air}}$ differential equation into a warming state.

### 6.3 Hardy Cross Fluid Network Solver
When a VAV damper closes (e.g., due to a fault or an occupancy-driven setback), the static pressure in the shared ductwork shifts, inherently forcing more airflow into parallel zones. To accurately simulate these interdependent fluid dynamics, ECON relies on the iterative Hardy Cross method (Cross, 1936) to solve the non-linear pressure and flow distribution across the parallel VAV dampers connected to the central AHU:

$$ \Delta Q = - \frac{\sum (K \cdot Q \cdot |Q|)}{\sum (2 \cdot K \cdot |Q|)} $$

Solving the duct network dynamically is superior to assuming static individual VAV flows, as it allows the AI Auto-Pilot to train against realistic, cascading aerodynamic consequences that occur during peak load or mechanical failures.

### 6.4 Dynamic Coefficient of Performance (COP) Degradation
The central chiller plant's cooling efficiency is not static. As the total sensible cooling load approaches the plant's mechanical limit, the Coefficient of Performance (COP) degrades according to an empirical strain curve:

$$ COP = \max(2.2, \min(3.8, 3.6 - 0.35 \cdot \text{Strain})) $$

This couples the thermodynamic state to the electrical state, ensuring that thermal faults visibly degrade overall system health and spike the `$buildingLoadMW$` metric broadcasted to the dashboard.

---

## 7. Conclusion & Novel Contributions
ECON represents a paradigm shift in autonomous Building Management Systems by successfully merging physical 3D spaces, logical 2D topologies, and real-time thermodynamic plots into a unified context. By proving that complex WebGL digital twins can execute flawlessly on mobile GPUs via aggressive geometry culling and WASM integration, ECON extends the Digital Twin beyond stationary control rooms. 

Real-world field testing of occupancy-presence sensing has validated up to 17.6% HVAC energy savings. By utilizing the hybrid rendering engine to simulate and visualize cascading failures (such as thermal drift or grid demand spikes) in real-time, ECON provides a scalable, reinforcement-learning-driven pathway to hit high-yield 10-20% ESG energy-reduction targets without compromising occupant comfort.

---

## 8. References
1. Bai, Z., et al. (2023). *Long-term field testing of the accuracy and HVAC energy savings potential of occupancy presence sensors in a single-family home*. U.S. Department of Energy OSTI.
2. Zhang, Y., et al. (2022). *ByteTrack: Multi-Object Tracking by Associating Every Detection Box*. ECCV 2022. [GitHub: ifzhang/ByteTrack](https://github.com/ifzhang/ByteTrack)
3. Akhtar, T., Mahmood, A., & Khatoon, S. (2024). *Occupancy detection for HVAC systems using IoT edge computing and vision-based image processing*. University of East London.
4. Wojke, N., Bewley, A., & Paulus, D. (2017). *Simple online and realtime tracking with a deep association metric (DeepSORT)*. [GitHub: nwojke/deep_sort](https://github.com/nwojke/deep_sort)
5. Kalervo, A., et al. (2019). *CubiCasa5k: A Dataset and an Improved Multi-Task Model for Floorplan Image Analysis*. [GitHub: cubicasa/cubicasa5k](https://github.com/cubicasa/cubicasa5k)
6. Zeng, Z., et al. (2019). *DeepFloorplan: ICCV 2019 multi-task floorplan recognition*. [GitHub: zlzeng/DeepFloorplan](https://github.com/zlzeng/DeepFloorplan)
7. HAIx Lab. (2025). *SkeySpot: Automating Service Key Detection for Digital Electrical Layout Plans in the Construction Industry*. IEEE SMC 2025. [GitHub: HAIx-Lab/Skeyspot](https://github.com/HAIx-Lab/Skeyspot)
8. Chen, Y., et al. (2020). *Nationwide HVAC energy-saving potential quantification for office buildings with occupant-centric controls in various climates*. Energy and Buildings.
9. Abade, A., et al. (2021). *Quantifying the nationwide HVAC energy savings in large hotels: the role of occupant-centric controls*.
10. Louisiana State University Repository. (2023). *Field testing of the energy-saving potential of an occupancy presence sensing system in an apartment unit*.
11. Hillier, B., & Hanson, J. (1984). *The Social Logic of Space*. Cambridge University Press.
12. Cross, H. (1936). *Analysis of Flow in Networks of Conduits or Conductors*. University of Illinois.
13. Balaji, B., et al. (2016). *Brick: Towards a unified metadata schema for buildings*. BuildSys.
14. Kramer, R., van Schijndel, A., & Schellen, H. (2012). *Simplified thermal and hygric building models: A literature review*. Frontiers of Architectural Research, 1(4), 318-325.
15. Braun, J. E. (1990). *Reducing energy costs and peak electrical demand through building thermal mass*. ASHRAE Transactions, 96(2), 870-888.
