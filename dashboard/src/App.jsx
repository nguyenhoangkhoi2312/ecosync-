import { useState, useCallback, useEffect, useRef } from 'react';
import { Users, Wind, Box, Zap, AlertTriangle, Activity, Settings, Map } from 'lucide-react';
import { ReactFlow, Background, Controls, Handle, Position, applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import BuildingModel from './BuildingModel';
import WindSimulationCanvas from './WindSimulation';
import { physicsEngine } from './simulationEngine';

// --- P&ID ENGINEERING CUSTOM NODES ---
const ThermalNode = ({ data, selected }) => {
  let stateClass = 'glow-blue'; 
  if (data.alert === true || data.alert === 'FAULT') stateClass = 'glow-red';
  else if (data.alert === 'REMEDIATING') stateClass = 'glow-yellow';
  else if (data.integration_score > 1.0) stateClass = 'glow-red'; 
  else if (data.integration_score > 0.8) stateClass = 'glow-green';

  return (
    <div className={`thermal-node ${selected ? 'selected' : ''} ${stateClass}`}>
      <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
      <div className="thermal-label">{data.label}</div>
      <div className="thermal-value">{data.temp}°C</div>
      <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{data.occupancy} PAX</div>
      <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
    </div>
  );
};

const AHUNode = ({ data, selected }) => (
  <div className={`node-ahu ${selected ? 'selected' : ''} ${data.status === 'FAULT' ? 'fault' : ''}`}>
    <div className="thermal-label" style={{ color: 'var(--accent-blue)' }}>{data.label}</div>
    <div className="thermal-value">SP: {data.pressure?.toFixed(0) || 500} Pa</div>
    <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>M: AUTO</div>
    <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
  </div>
);

const VAVNode = ({ data, selected }) => (
  <div className={`node-vav ${selected ? 'selected' : ''}`}>
    <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
    <div style={{ fontSize: '9px', fontWeight: 'bold', color: 'var(--text-primary)' }}>VAV</div>
    <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>{data.flow.split(' ')[0]}</div>
    <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
  </div>
);

const FloorplanImageNode = () => (
  <div className="floorplan-img-node" style={{ width: 800, height: 600, pointerEvents: 'none' }}>
    <img src="/floorplan.png" alt="Blueprint" style={{ width: '100%', height: '100%', opacity: 0.6, objectFit: 'contain' }} />
  </div>
);

const nodeTypes = {
  zone: ThermalNode,
  ahu: AHUNode,
  vav: VAVNode,
  floorplan: FloorplanImageNode
};

const buildTopologyFromSim = (simState, activeFloor) => {
  const nodes = [];
  const edges = [];
  
  nodes.push({ 
    id: 'ahu-main', 
    type: 'ahu', 
    position: { x: 320, y: -250 }, 
    data: { 
      label: 'AHU-MAIN', 
      status: simState.scenario === 'fault' ? 'FAULT' : 'NOMINAL',
      pressure: simState.ahuPressure
    } 
  });
  
  const zScale = 25; // Increase scale to spread out nodes
  
  const activeZones = Object.values(simState.zones).filter(z => z.level === activeFloor);

  activeZones.forEach(z => {
    // The new BIM schema uses coordinates in [0, 40] meters
    const cx = z.centroid.x - 20; // Center around 0
    const cy = z.centroid.y - 20;
    
    nodes.push({
      id: z.id,
      type: 'zone',
      position: { x: cx * zScale, y: cy * zScale },
      draggable: false,
      data: {
        label: z.label,
        temp: z.temp,
        occupancy: z.occupancy,
        alert: z.alert,
        integration_score: z.integration_score
      }
    });
  });

  Object.values(simState.vavs).forEach(v => {
    const z = simState.zones[v.targetZone];
    if (!z || z.level !== activeFloor) return; // Only process VAVs on active floor

    const cx = z.centroid.x - 20;
    const cy = z.centroid.y - 20;

    nodes.push({
      id: v.id,
      type: 'vav',
      position: { x: cx * zScale, y: cy * zScale - 60 },
      draggable: false,
      data: { label: v.id.toUpperCase(), flow: v.flow.toFixed(1) + ' m³/m' }
    });

    const isHighFlow = v.resistance < 1;
    const isFault = simState.scenario === 'fault' && v.id === 'vav-server-6a';
    const isRem = simState.scenario === 'remediating' && isHighFlow;

    edges.push({
      id: `e-ahu-${v.id}`,
      source: 'ahu-main',
      target: v.id,
      type: 'step',
      animated: !isFault,
      style: { stroke: isFault ? 'var(--accent-red)' : (isRem ? 'var(--accent-yellow)' : 'var(--accent-blue)'), strokeWidth: isHighFlow ? 2 : 1, strokeDasharray: isFault ? '4 4' : 'none' }
    });

    edges.push({
      id: `e-${v.id}-${z.id}`,
      source: v.id,
      target: z.id,
      type: 'step',
      animated: !isFault,
      style: { stroke: isFault ? 'var(--accent-red)' : (isRem ? 'var(--accent-yellow)' : 'var(--accent-blue)'), strokeWidth: isHighFlow ? 2 : 1, strokeDasharray: isFault ? '4 4' : 'none' }
    });
  });

  return { nodes, edges };
};

function CircularGauge({ value, max, label, unit, color }) {
  const radius = 30;
  const stroke = 4;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (Math.min(value, max) / max) * circumference;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ position: 'relative', width: '70px', height: '70px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg style={{ position: 'absolute', transform: 'rotate(-90deg)' }} width="70" height="70">
          <circle cx="35" cy="35" r={radius} fill="none" stroke="var(--border-glass)" strokeWidth={stroke} />
          <circle cx="35" cy="35" r={radius} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={circumference} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
        </svg>
        <span className="mono" style={{ fontSize: '1rem', fontWeight: '500', color: 'var(--text-primary)' }}>{value}</span>
      </div>
      <span className="label-sm" style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-secondary)' }}>{label} ({unit})</span>
    </div>
  );
}

function App() {
  const [activeScenario, setActiveScenario] = useState('peak');
  const [autoPilot, setAutoPilot] = useState(true);
  const [activeFloor, setActiveFloor] = useState(6);
  const [showAiModal, setShowAiModal] = useState(false);
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(false);
  const [showWindSim, setShowWindSim] = useState(false);
  
  // Initial topology
  const initialTopo = buildTopologyFromSim(physicsEngine.getState(), 6);
  const [nodes, setNodes] = useState(initialTopo.nodes);
  const [edges, setEdges] = useState(initialTopo.edges);
  const [liveLogs, setLiveLogs] = useState([]);
  const [simData, setSimData] = useState(physicsEngine.getState());
  
  const logEndRef = useRef(null);

  // TEMP debug hook: drive floor changes from the preview console
  useEffect(() => { if (typeof window !== 'undefined') window.__setFloor = setActiveFloor; }, []);

  const selectedNode = nodes.find(n => n.selected);

  const onNodesChange = useCallback((changes) => setNodes((nds) => applyNodeChanges(changes, nds)), []);
  const onEdgesChange = useCallback((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), []);

  const loadScenario = (key) => {
    setActiveScenario(key);
    physicsEngine.setScenario(key);
  };

  useEffect(() => {
    if (activeScenario === 'fault' && autoPilot) {
      setShowAiModal(true);
    } else {
      setShowAiModal(false);
    }
  }, [activeScenario, autoPilot]);

  const executeRemediation = () => {
    setShowAiModal(false);
    loadScenario('remediating');
    setTimeout(() => {
      loadScenario('peak');
    }, 8000);
  };

  // When activeFloor changes, completely rebuild the topology
  useEffect(() => {
    const topo = buildTopologyFromSim(physicsEngine.getState(), activeFloor);
    setNodes(topo.nodes);
    setEdges(topo.edges);
  }, [activeFloor]);

  // Physics Engine Loop
  useEffect(() => {
    let lastTime = performance.now();
    const interval = setInterval(() => {
      const now = performance.now();
      const dt = (now - lastTime) / 1000; // seconds
      lastTime = now;
      
      physicsEngine.tick(dt);
      const state = physicsEngine.getState();
      
      setSimData(state);
      setLiveLogs(state.logs);
      
      // We don't overwrite the selected state, we carefully update the node data
      setNodes(nds => nds.map(n => {
        if (n.type === 'zone' && state.zones[n.id]) {
            return { ...n, data: { ...n.data, temp: state.zones[n.id].temp.toFixed(2), alert: state.zones[n.id].alert } };
        }
        if (n.type === 'vav' && state.vavs[n.id]) {
            return { ...n, data: { ...n.data, flow: state.vavs[n.id].flow.toFixed(1) + ' m³/m' } };
        }
        if (n.type === 'ahu') {
            return { ...n, data: { ...n.data, pressure: state.ahuPressure } };
        }
        return n;
      }));
      
      // Update edge styles based on faults/flow
      const newTopo = buildTopologyFromSim(state, activeFloor);
      setEdges(newTopo.edges);
      
    }, 100);
    return () => clearInterval(interval);
  }, [activeFloor]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [liveLogs]);

  return (
    <div className="hud-container">
      
      {/* LAYER 0: The Full 3D Node-Graph Engine */}
      <BuildingModel simState={simData} activeFloor={activeFloor} onFloorClick={setActiveFloor} />

      {/* AI INTERACTIVE MODAL OVERLAY */}
      {showAiModal && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 50, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--accent-red)', padding: '2rem', width: '500px' }}>
            <h2 style={{ color: 'var(--accent-red)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 0 }}>
              <AlertTriangle size={24} /> ALARM DETECTED
            </h2>
            <p style={{ color: 'var(--text-primary)', lineHeight: 1.5, fontFamily: 'monospace' }}>
              ERR: SERVER_ROOM_THERMAL_RUNAWAY<br/>
              d/dt(T) = +1.2 C/min
            </p>
            <div style={{ background: '#000', padding: '1rem', margin: '1.5rem 0', border: '1px solid var(--border-glass)' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--accent-blue)', textTransform: 'uppercase', letterSpacing: '1px' }}>SCADA Override Script</span>
              <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                SET VAV_NORTH_RESISTANCE = 10.0<br/>
                SET VAV_CORE_RESISTANCE = 0.1
              </p>
            </div>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
              <button className="cmd-btn" onClick={() => loadScenario('peak')}>IGNORE</button>
              <button className="cmd-btn active-fault" onClick={executeRemediation} style={{ background: 'var(--accent-red)' }}>EXECUTE RECOMMENDATION</button>
            </div>
          </div>
        </div>
      )}

      {/* LAYER 1: React Flow Topology in Bottom Right Corner */}
      <div className="minimap-wrapper" style={{ width: '600px', height: '400px', bottom: '24px', right: '24px', padding: 0, overflow: 'hidden' }}>
        <div className="topology-panel" style={{ width: '100%', height: '100%', position: 'relative' }}>
          <div className="panel-header" style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, padding: '12px 16px', background: 'var(--bg-panel)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-primary)', fontWeight: 'bold' }}>MAP LEVEL {activeFloor} TOPOLOGY</span>
            
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <button 
                 onClick={() => setShowWindSim(!showWindSim)}
                 style={{ 
                   background: 'transparent', 
                   border: '1px solid var(--accent-blue)', 
                   color: 'var(--accent-blue)', 
                   fontSize: '9px', 
                   padding: '4px 8px', 
                   cursor: 'pointer',
                   fontWeight: 'bold',
                   pointerEvents: 'auto'
                 }}
              >
                 {showWindSim ? 'VIEW 2D P&ID' : 'VIEW 3D WIND'}
              </button>
              <span style={{ fontSize: '10px', color: 'var(--accent-blue)' }}>{nodes.length - 1} ACTIVE NODES</span>
            </div>
          </div>

          {showWindSim ? (
             <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 5, background: '#0a0a0a', pointerEvents: 'auto' }}>
               <WindSimulationCanvas simState={simData} />
             </div>
          ) : (
             <ReactFlow 
               nodes={nodes} 
               edges={edges} 
               onNodesChange={onNodesChange}
               onEdgesChange={onEdgesChange}
               nodeTypes={nodeTypes}
               fitView
               fitViewOptions={{ padding: 0.1 }}
               proOptions={{ hideAttribution: true }}
               minZoom={0.1}
               maxZoom={1.5}
               translateExtent={[[-800, -800], [800, 800]]}
               nodesDraggable={false}
             >
               <Background gap={40} size={1} color="rgba(255,255,255,0.05)" />
             </ReactFlow>
          )}
        </div>
      </div>

      {/* LAYER 4: AI & TELEMETRY (Left Dock) */}
      <div style={{ position: 'absolute', top: '1.5rem', left: '1.5rem', zIndex: 50 }}>
        <button 
           onClick={() => setIsLeftPanelOpen(!isLeftPanelOpen)}
           style={{ 
             background: 'var(--bg-panel)', 
             border: '1px solid var(--border-glass)', 
             color: 'var(--text-primary)', 
             padding: '8px 12px', 
             cursor: 'pointer',
             display: 'flex',
             alignItems: 'center',
             gap: '8px'
           }}
        >
           <Activity size={16} color="var(--accent-blue)" /> 
           <span style={{ fontSize: '10px', fontWeight: 'bold' }}>{isLeftPanelOpen ? 'HIDE AI & TELEMETRY' : 'SHOW AI & TELEMETRY'}</span>
        </button>
      </div>

      {isLeftPanelOpen && (
        <aside className="hud-dock-left" style={{ top: '4.5rem', height: 'calc(100vh - 6rem)' }}>
          <div className={`ai-synthesis-card ${activeScenario === 'fault' ? 'critical' : activeScenario === 'remediating' ? 'remediating' : ''}`}>
            <div className="ai-header">
              <Activity size={16} />
              <span>AI Scenario Synthesis</span>
            </div>
            <div className="ai-text">
              {activeScenario === 'fault' ? "CRITICAL: Server Room IT Load overriding cooling capacity. Airflow restriction detected via Hardy Cross pressure balance iteration. Temperature rising continuously." 
               : activeScenario === 'remediating' ? "AI OVERRIDE: Closing office dampers (10.0 Resistance) to force maximum VAV cooling capacity into the core. Thermodynamics converging." 
               : "Physics simulation running dynamically at 10 ticks per second using discrete-time Euler method equations for transient heat transfer."}
            </div>
          </div>

          <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: 0, marginTop: '1rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Live Telemetry Stream
            </span>
            <div className="terminal-log-window mono">
              {liveLogs.map(log => (
                <div key={log.id} className={`log-line ${log.critical ? 'log-critical' : ''}`} style={{ color: activeScenario === 'remediating' ? 'var(--accent-yellow)' : undefined }}>
                  <span className="log-timestamp">[{log.time}]</span>
                  <span className="log-source">{log.source}</span>
                  <span className="log-payload">{log.msg}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        </aside>
      )}

      {/* LAYER 2: Right Dock (Node Inspector moved up) */}
      <aside className="hud-dock-right">
        <div className="hud-header" style={{ marginBottom: '0', paddingBottom: '0.5rem', borderBottom: 'none' }}>
          <h2 style={{ fontSize: '1.25rem', color: 'var(--text-primary)' }}>{selectedNode ? 'Node Inspector' : 'Global Metrics'}</h2>
          <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{selectedNode?.id || 'OVERVIEW'}</span>
        </div>

        {!selectedNode ? (
          <>
            <div className="data-group" style={{ marginBottom: '0' }}>
               <div className="data-row">
                  <span className="data-label">Selected Level</span>
                  <span className="data-value mono" style={{ color: 'var(--accent-blue)' }}>L{activeFloor}</span>
               </div>
               <div className="data-row">
                  <span className="data-label">Space Syntax Hub</span>
                  <span className="data-value mono" style={{ color: 'var(--accent-red)' }}>Server-Room</span>
               </div>
               <div className="data-row">
                  <span className="data-label">Sys Health</span>
                  <span className="data-value mono" style={{ color: activeScenario === 'fault' ? 'var(--accent-red)' : activeScenario === 'remediating' ? 'var(--accent-yellow)' : 'var(--accent-green)' }}>
                    {activeScenario === 'fault' ? '42%' : activeScenario === 'remediating' ? '68%' : '98%'}
                  </span>
               </div>
            </div>

            <div className="gauge-cluster" style={{ border: 'none', margin: '0', padding: '1rem 0' }}>
              <CircularGauge value={412} max={500} label="Occupants" unit="pax" color="var(--accent-blue)" />
              <CircularGauge value={activeScenario === 'fault' ? 29.4 : activeScenario === 'remediating' ? 26.1 : 24.1} max={35} label="Avg Temp" unit="°C" color="var(--accent-yellow)" />
            </div>
          </>
        ) : selectedNode?.type === 'zone' ? (
          <>
            <div className="data-group" style={{ marginBottom: '0' }}>
              <div className="data-row">
                <span className="data-label">Identifier</span>
                <span className="data-value mono">{selectedNode.data.label}</span>
              </div>
              <div className="data-row">
                <span className="data-label">Status</span>
                <span className="data-value" style={{ fontSize: '0.75rem', padding: '2px 6px', borderRadius: '4px', background: selectedNode.data.alert === true || selectedNode.data.alert === 'FAULT' ? 'rgba(239,68,68,0.2)' : selectedNode.data.alert === 'REMEDIATING' ? 'rgba(234,179,8,0.2)' : 'rgba(34,197,94,0.2)', color: selectedNode.data.alert === true || selectedNode.data.alert === 'FAULT' ? 'var(--accent-red)' : selectedNode.data.alert === 'REMEDIATING' ? 'var(--accent-yellow)' : 'var(--accent-green)' }}>
                  {selectedNode.data.alert === true ? 'ALARM' : selectedNode.data.alert === 'REMEDIATING' ? 'REMEDIATING' : 'NOMINAL'}
                </span>
              </div>
              <div className="data-row">
                <span className="data-label">Integ. Score</span>
                <span className="data-value mono" style={{ color: selectedNode.data.integration_score > 1 ? 'var(--accent-red)' : 'var(--accent-blue)' }}>
                  {(selectedNode.data.integration_score ?? 0).toFixed(3)}
                </span>
              </div>
            </div>

            <div className="gauge-cluster" style={{ border: 'none', margin: '0', padding: '1rem 0' }}>
              <CircularGauge value={selectedNode.data.occupancy} max={80} label="Pax" unit="pax" color={selectedNode.data.alert ? 'var(--accent-red)' : 'var(--accent-blue)'} />
              <CircularGauge value={parseFloat(selectedNode.data.temp)} max={35} label="Temp" unit="°C" color={selectedNode.data.alert ? 'var(--accent-red)' : 'var(--accent-yellow)'} />
            </div>
          </>
        ) : (
          <p className="label-sm" style={{ color: 'var(--text-secondary)' }}>Detailed metrics only available for Zone Nodes.</p>
        )}
      </aside>

      {/* LAYER 3: Command Bar & Top Badges */}
      <div className="hud-top-badge">
        <Activity size={18} color="var(--accent-blue)" />
        <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Bldg Load</span>
        <span className="mono" style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          {activeScenario === 'fault' ? '1.92' : activeScenario === 'remediating' ? '2.84' : '4.15'} MW
        </span>
      </div>

      <div className="hud-command-bar">
        <button 
          className={`cmd-btn ${activeScenario === 'peak' ? 'active-peak' : ''}`} 
          onClick={() => loadScenario('peak')}
        >
          <Zap size={16} /> Peak Load Scenario
        </button>
        <button 
          className={`cmd-btn ${activeScenario === 'fault' ? 'active-fault' : ''}`} 
          onClick={() => loadScenario('fault')}
        >
          <AlertTriangle size={16} /> Critical Fault
        </button>
        <button 
          className={`cmd-btn ${autoPilot ? 'active-auto' : ''}`} 
          onClick={() => setAutoPilot(!autoPilot)}
        >
          <Settings size={16} /> AI Auto-Pilot: {autoPilot ? 'ON' : 'OFF'}
        </button>
      </div>

    </div>
  );
}

export default App;
