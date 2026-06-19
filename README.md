# EcoSync

EcoSync is an AI-driven, evidence-based smart building management system designed to optimize energy consumption while preserving optimal indoor environmental quality for occupants. By synthesizing computer vision, building digitization, edge computing, and scientifically-grounded optimization algorithms, EcoSync autonomously adjusts HVAC and lighting systems in real-time.

## 🔬 Scientific Foundation
The core decision-making of EcoSync is grounded in empirical research. Instead of relying on static, arbitrary setpoints, the backend **Scientific Optimizer** dynamically queries scientific databases (e.g., ArXiv) to extract the most up-to-date peer-reviewed bounds for indoor climate parameters (such as Temperature and CO2 levels) that maximize human cognitive performance and well-being.
- **Evidence-Based Setpoints**: Constrains the optimization engine to adhere to scientifically validated thresholds (e.g., Temperature ≤ 24.5°C, CO2 ≤ 1000 ppm).
- **Dynamic Policy Tuning**: Continually synthesizes semantic contexts from scientific abstracts to adjust internal policies regarding thermal comfort and air quality.

## 🛠 Tools & Algorithms

### 1. AI Modules
**Branch A: Occupancy Tracking**
- **Algorithm**: YOLOv11 combined with ByteTrack (Tracking-by-Detection).
- **Purpose**: Real-time people counting for low-to-medium density areas (offices, hallways) by tracking individuals crossing virtual line zones.
- **Tools**: YOLOv11, ByteTrack, Density Mapping algorithms.

**Branch B: Building Digitization (Digital Twin)**
- **Algorithm**: DeepFloorplan & Topological Graph Search.
- **Purpose**: Automatically extracts structural information from 2D building blueprints (room boundaries, walls, doors) and maps them to an electrical layout.
- **Tools**: OpenCV (`digitize_opencv.py`), SKeySpot, OCR Graph Search, JSON topological graph representations.

### 2. Backend: Core Engine & Forecasting
- **Role**: The central "brain" of EcoSync.
- **Mechanism**: Fuses spatial metadata from the Digital Twin (Branch B) with real-time occupancy and flow data (Branch A) to infer exactly how many people are in a given zone and what devices map to that zone.
- **Algorithms**: Predictive energy forecasting models, Scientific Constraint Optimization (via `scientific_optimizer.py`).
- **Tools**: Python, Fast API / Flask (Routing), ArXiv API integrations.

### 3. Edge Computing Gateway
- **Role**: Hardware interfacing for telemetry and actuation.
- **Implementation**: ESP32 microcontrollers and Raspberry Pi gateways.
- **Functions**: 
  - Reads environmental data from local sensors (e.g., IR arrays).
  - Emits IR signals to control legacy HVAC units.
  - Triggers relays for direct lighting control.
- **Tools**: PlatformIO, C++, MQTT (for bidirectional communication with the core engine).

### 4. Dashboard (Web UI)
- **Role**: The command center for Facility Managers.
- **Features**: 
  - Real-time visualization of occupancy and energy usage.
  - Predicted peak demand alerts.
  - CO2 reduction metrics and ROI visualization.
  - Wind simulation and 3D building modeling.
  - Manual override controls for the AI optimizer.
- **Tools**: React, Vite, Zustand (state management).

## 📈 Current Progress
- **AI Modules**: YOLOv11+ByteTrack integration is implemented for occupancy counting (`count_occupancy.py`). DeepFloorplan digitization has successfully generated digitized topological outputs (`topologic_graph.json`, `digital_twin_layout.json`) from sample blueprints.
- **Backend Core**: The scientific optimizer is functional, successfully querying the ArXiv API to generate `scientific_setpoints.json`. The central routing and database schemas are established.
- **Edge Gateway**: ESP32 PlatformIO project structure is in place with logic to read sensors and actuate IR/relays (`main.cpp`).
- **Dashboard UI**: The Vite+React application is set up with states managed by Zustand. Components for 3D Building Modeling and Wind Simulation are actively integrated.
- **Overall Architecture**: The project is successfully structured into discrete, functional modules (AI, Backend, Edge, Dashboard) and version control has been initialized.