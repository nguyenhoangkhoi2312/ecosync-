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

## 🚧 Unimplemented Features Report

While Sprint 1 successfully proved the core architecture and physics engine, several critical features remain unimplemented before the platform is ready for production.

### 1. True BIM Integration (Sprint 2)
- **Current State:** The 3D layout, topology, and thermal properties are driven by a hardcoded mock file (`building-data.json`).
- **Missing:** Native `.ifc` (Industry Foundation Classes) file parsing using `web-ifc` or ThatOpen Company tooling.
- **Missing:** Automated extraction of bounding boxes, space volumes, and wall geometries directly from the BIM models to feed into the thermodynamic simulation.
- **Missing:** LOD (Level of Detail) optimization and geometry reduction pipelines to keep the browser performant when loading massive 50+ story skyscraper models.

### 2. Time-Series Database & Analytics (Sprint 3)
- **Current State:** The `docker-compose.yml` initializes a `timescaledb` (PostgreSQL) container, but the Go backend does not yet write any telemetry data to it. The system currently only streams live ephemeral data.
- **Missing:** A robust ingestion pipeline in Go to batch-insert the 30FPS FlatBuffers telemetry into TimescaleDB efficiently.
- **Missing:** REST or GraphQL API endpoints to query historical chunks, aggregations, and downsampled data.
- **Missing:** Frontend charts and historical timelines to scrub backwards and analyze past thermal anomalies.

### 3. Advanced Capabilities & Security
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
cd dashboard

# Install all Node.js dependencies
npm install

# Start the Vite development server
npm run dev
```

### 3. Accessing the Application
- Open your web browser and navigate to `http://localhost:5173` (or the port Vite provides in your terminal).
- You should immediately see the 3D building render and the topology map populate with live temperature data streaming from the Go backend.

### Troubleshooting
- **Frontend isn't receiving data?** Ensure the backend is running and port `8080` is not blocked. Check the browser console (F12) for WebSocket connection errors.
- **Docker port conflict?** If port `8080` or `5432` is already in use by another application on your machine, stop the conflicting application or map different ports in the `docker-compose.yml` file.