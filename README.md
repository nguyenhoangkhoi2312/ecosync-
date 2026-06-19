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

## 🚧 Digital Twin: Project Analysis & Limitations

This section provides an exhaustive analysis of the EcoSync project's current state, achievements, and technical limitations. It is designed to be used as a prompt/context file for advanced research tools (like Perplexity or architectural research agents) to help source production-grade algorithms, real-world data, and architectural blueprints for the next iteration of the project.

### 1. Project Context & Achievements
**Project Vision**: A real-time, browser-based 3D Digital Twin and Building Management System (BMS) dashboard for a 14-story commercial building. Current Tech Stack: React, React Three Fiber (Three.js), React Flow (for network topology), three-bvh-csg (Constructive Solid Geometry), and WebGL Shaders.

**Key Milestones Achieved**:
- **Procedural 3D Architecture**: Successfully built a 14-story procedural geometry engine capable of rendering dynamic floor plates, exterior walls, and window cutouts using a JSON-based BIM schema.
- **Thermodynamic Heatmaps**: Developed a custom WebGL Fragment Shader (`ZoneRenderer`) that paints continuous temperature gradients onto 3D office zones based on live thermodynamic simulations.
- **Interactive Data Overlays**: Integrated floating UI panels and dynamic hover states (`<Edges>` wireframes) to allow users to interactively slice through building floors.
- **Topology Mapping**: Linked the 3D model to a 2D React Flow canvas, allowing users to trace the physical relationships between Air Handling Units (AHUs), Variable Air Volume (VAV) boxes, and spatial zones.

### 2. Current Limitations & Challenges
While the prototype successfully proves the concept, it relies on several simplified assumptions. To evolve into a production-grade enterprise application, the following limitations must be addressed:

#### A. Architectural Realism & True BIM Integration
- **Limitation**: The current building is generated from simplified 2D coordinate arrays (e.g., `[[0, 0], [40, 0], ...]`) hardcoded into a JSON file. The building looks like a generic block tower rather than a realistic, aesthetically pleasing commercial structure.
- **Challenge**: Extracting and rendering massive, highly detailed building data (doors, interior walls, furniture, exact window mullions) without crashing the browser.
- **Research Required**:
  - Find open-source, high-quality IFC (Industry Foundation Classes) or Revit (`.rvt`) models of real commercial buildings or hospitals.
  - Research web-based BIM parsers like `web-ifc`, `IFC.js`, or Speckle to dynamically load real architectural blueprints into React Three Fiber.

#### B. Performance Scaling of Boolean Geometry
- **Limitation**: To cut windows out of walls, the app uses Constructive Solid Geometry (`three-bvh-csg`). While optimized via caching, running CSG operations for thousands of complex structural elements (pipes, ducts, complex facades) is too slow for real-time web rendering.
- **Challenge**: Maintaining high framerates (60 FPS) while rendering highly repetitive, complex geometry.
- **Research Required**:
  - Investigate GPU Instancing (`InstancedMesh`) and `BatchedMesh` algorithms in Three.js for rendering thousands of identical windows or structural beams in a single draw call.

#### C. Advanced HVAC & Computational Fluid Dynamics (CFD)
- **Limitation**: The `simulationEngine.js` currently uses a rudimentary algebraic formula to calculate temperature changes (e.g., adding base heat and subtracting cooling power). It treats each zone as a single uniform block of air.
- **Challenge**: Real-world HVAC management requires understanding how air flows and mixes within a space, especially in large open-plan offices.
- **Research Required**:
  - Find lightweight WebGL-based Navier-Stokes solvers or Lattice Boltzmann methods (LBM) capable of running real-time 2D/3D wind and fluid dynamic simulations in the browser.
  - Research how to map real-time CFD vector fields onto Three.js particle systems for stunning, realistic airflow visualizations.

#### D. Standardized Data Ontologies & P&ID Layouts
- **Limitation**: The current mechanical topology (AHU -> VAV -> Zone) is a custom, simplistic JSON tree. The visual layout in React Flow is basic and doesn't resemble a professional engineer's Piping and Instrumentation Diagram (P&ID).
- **Challenge**: Automatically generating readable, standardized schematic graphs from chaotic real-world sensor data networks.
- **Research Required**:
  - Research IoT building standards like Project Haystack or Brick Schema for semantic tagging of building equipment.
  - Investigate advanced graph routing algorithms (e.g., dagre, ELK.js, or WebCola) to auto-generate orthogonal, professional-grade P&ID diagrams inside React Flow without overlapping edges.