# EcoSync Enterprise Digital Twin

EcoSync is a high-performance Digital Twin platform designed to bridge Building Information Modeling (BIM) data with real-time SCADA/HVAC telemetry. It features a lightweight React/Three.js frontend and a heavy-duty Go backend that runs physical thermodynamic simulations and streams state via WebSockets.

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

## 🚧 Unimplemented Features & Next Steps

This repository represents the completion of **Sprint 1**. The following features are planned for future sprints:

### Sprint 2: True BIM Integration
- **IFC Parsing:** Replace the hardcoded `building-data.json` with an actual `.ifc` file using `web-ifc` or ThatOpen tooling.
- **Geometry Reduction:** Implement preprocessing to extract and filter only the architectural shells, spaces, and HVAC equipment necessary for the digital twin to ensure the browser remains performant even with 50-story models.

### Sprint 3: Time-Series Database & Analytics
- **TimescaleDB Integration:** While the PostgreSQL/TimescaleDB container is initialized in `docker-compose.yml`, the Go backend still needs to be wired up to continuously ingest and persist the telemetry stream.
- **Historical Queries:** Build an API in Go to query historical chunks and display them on frontend charts for long-term trend analysis.

### Advanced Capabilities
- **Semantic Mapping:** Build a robust mapping layer to automatically bind BIM GUIDs (Asset IDs) to their corresponding SCADA telemetry tags (e.g., BACnet IP endpoints).
- **Machine Learning Inference:** Replace the current threshold-based alerts with an ML model that predicts thermal anomalies based on historical weather and occupancy data.
- **Security & Authentication:** Secure the WebSocket and API endpoints, which are currently open for local development.

## 🛠️ How to Run

1. **Start the Backend:**
   ```bash
   cd server
   docker-compose up -d --build
   ```

2. **Start the Frontend:**
   ```bash
   cd dashboard
   npm install
   npm run dev
   ```