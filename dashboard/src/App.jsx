import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Users, Wind, Box, Zap, AlertTriangle, Activity, Settings, Map, Camera, Cpu, Thermometer } from 'lucide-react';
import { ReactFlow, Background, Controls, Handle, Position, applyNodeChanges, applyEdgeChanges, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import BuildingModel, { SingleFloorLayout } from './BuildingModel';
import buildingData from './building-data.json';
import TelemetryPanel from './TelemetryPanel';
import GlobalMetricsPanel from './GlobalMetricsPanel';
import TelemetryLogs from './TelemetryLogs';
import MaintenanceDrawer from './MaintenanceDrawer';
import AiInsightsPanel from './AiInsightsPanel';
import * as flatbuffers from 'flatbuffers';
import MobileImpactScreen from './MobileImpactScreen';
import UIErrorBoundary from './UIErrorBoundary';
import { SimState } from './telemetry';
import { useDigitalTwin, FAULT_ZONES, DEFAULT_FAULT_TARGET } from './useDigitalTwin';
import AirflowWindow from './AirflowWindow';
import CanvasErrorBoundary from './CanvasErrorBoundary';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Canvas } from '@react-three/fiber';


// --- P&ID ENGINEERING CUSTOM NODES ---
// Custom smoothstep implementation for heatmap color
const smoothstep = (min, max, value) => {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x * (3 - 2 * x);
};

const ThermalNode = ({ data, selected }) => {
  const setpoint = data.setpoint || 24.0;
  const deadband = data.deadband || 2.0;
  
  const deviation = (parseFloat(data.temp) - setpoint) / deadband;
  
  const rFloat = smoothstep(0.3, 1.0, deviation);
  const bFloat = smoothstep(0.3, 1.0, -deviation);
  const gFloat = 1.0 - Math.max(smoothstep(0.8, 1.5, deviation), smoothstep(0.8, 1.5, -deviation));

  const r = Math.round(rFloat * 255);
  const g = Math.round(gFloat * 255);
  const b = Math.round(bFloat * 255);

  const borderColor = `rgb(${r}, ${g}, ${b})`;
  const bgColor = `rgba(${r}, ${g}, ${b}, 0.1)`;

  return (
    <div className={`thermal-node ${selected ? 'selected' : ''} ${data.alert ? 'pulse-red-node' : ''}`} style={{ borderColor, backgroundColor: bgColor, transition: 'all 0.5s ease' }}>
      <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
      <div className="thermal-label">{data.label}</div>
      <div className="thermal-value">{data.temp}°C</div>
      <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{data.occupancy} PAX</div>
      <div style={{ fontSize: '7px', color: 'var(--accent-blue)', opacity: 0.8, marginTop: '2px', wordBreak: 'break-all', fontFamily: 'monospace' }}>BIM: {data.bim_asset_id?.split('-')[0]}</div>
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

const FloorplanNode = ({ data }) => {
  return (
    <div style={{ width: 800, height: 600, pointerEvents: 'none', position: 'relative' }}>
      <svg width="100%" height="100%" viewBox="0 0 800 600" preserveAspectRatio="none">
        {data.zones && data.zones.map((z, i) => {
          const points = z.polygon.map(p => `${(p[0] - 30) * 22 + 400},${(p[1] - 20) * 22 + 300}`).join(' ');
          return <polygon key={i} points={points} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" />;
        })}
      </svg>
    </div>
  );
};

const CameraNode = ({ selected }) => (
  <div className={`node-icon ${selected ? 'selected' : ''}`} style={{ background: 'var(--bg-panel)', padding: '4px', border: '1px solid var(--text-secondary)', borderRadius: '4px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
    <Camera size={12} color="var(--accent-blue)" />
    <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
  </div>
);

const SensorNode = ({ selected }) => (
  <div className={`node-icon ${selected ? 'selected' : ''}`} style={{ background: 'var(--bg-panel)', padding: '4px', border: '1px solid var(--accent-yellow)', borderRadius: '4px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
    <Thermometer size={12} color="var(--accent-yellow)" />
    <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
  </div>
);

const ElectricalPanelNode = ({ data, selected }) => (
  <div className={`node-panel ${selected ? 'selected' : ''}`} style={{ background: 'var(--bg-panel)', padding: '8px', border: '2px solid var(--accent-red)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
    <Zap size={16} color="var(--accent-red)" />
    <span style={{ fontSize: '8px', color: 'var(--text-primary)' }}>{data.label}</span>
    <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
  </div>
);

const CircuitNode = ({ selected }) => (
  <div className={`node-circuit ${selected ? 'selected' : ''}`} style={{ background: 'var(--bg-panel)', padding: '4px', border: '1px solid var(--accent-red)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
    <Cpu size={12} color="var(--accent-red)" />
    <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />
    <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />
  </div>
);

const nodeTypes = {
  zone: ThermalNode,
  ahu: AHUNode,
  vav: VAVNode,
  floorplan: FloorplanNode,
  camera: CameraNode,
  sensor: SensorNode,
  panel: ElectricalPanelNode,
  circuit: CircuitNode
};

const SCALE = 22; // Physical scaling multiplier

const buildTopologyFromSim = (simState, activeFloor, ontology) => {
  const nodes = [];
  const edges = [];

  const floorObj = buildingData.floors.find(f => f.level === activeFloor);
  const activeZonesData = floorObj ? floorObj.zones : [];

  const activeZones = Object.values(simState.zones)
    .filter(z => z.level === activeFloor);

  nodes.push({
    id: 'floorplan-bg', type: 'floorplan', position: { x: -400, y: -300 }, draggable: false,
    data: { zones: activeZonesData }, zIndex: -1
  });

  // AHU root, placed outside the North perimeter of the floor plan
  nodes.push({
    id: 'ahu-main', type: 'ahu', position: { x: -45, y: -25 * SCALE - 40 },
    data: { label: 'AHU-MAIN', status: simState.scenario === 'fault' ? 'FAULT' : 'NOMINAL', pressure: simState.ahuPressure }
  });

  // Normalize the Brick ontology to {source, target, predicate}. Tolerates both the legacy
  // shape ({ relationships: [{source, predicate, target}] }) and the digitized-pipeline shape
  // (a flat array of {subject, predicate, object}). Missing/empty ontology -> no edges (no crash).
  const rawRels = Array.isArray(ontology) ? ontology : (ontology?.relationships ?? []);
  const relationships = rawRels.map(r => ({
    source: r.source ?? r.subject,
    target: r.target ?? r.object,
    predicate: r.predicate,
  }));
  
  // Electrical Panel for the floor
  const panelId = `panel-lvl${activeFloor}`;
  nodes.push({
    id: panelId, type: 'panel', position: { x: 250, y: -25 * SCALE - 40 },
    data: { label: `EP-L${activeFloor}` }
  });

  activeZones.forEach((z) => {
    // 1. Map physical 3D centroid coordinates to 2D React Flow canvas
    // Subtracting 30 (width/2) and 20 (depth/2) centers the building around 0,0
    const x = (z.centroid.x - 30) * SCALE;
    const y = (z.centroid.y - 20) * SCALE;

    const isServerFault = simState.scenario === 'fault' && z.type === 'server-room';
    const isRem = simState.scenario === 'remediating' && (z.type === 'server-room' || z.type === 'core');
    
    // 2. SVG Linear Gradient Vector Colors
    const gradientId = isServerFault ? 'flow-fault' : (isRem ? 'flow-rem' : 'flow-nominal');
    const markerColor = isServerFault ? 'var(--accent-red)' : (isRem ? 'var(--accent-yellow)' : 'var(--accent-green)');
    
    const edgeStyle = { stroke: `url(#${gradientId})`, strokeWidth: 2, strokeDasharray: isServerFault ? '4 4' : '5 5' };
    const markerEnd = { type: MarkerType.ArrowClosed, color: markerColor };
    const className = !isServerFault ? 'edge-flow-vector-fast' : 'edge-flow-vector';

    nodes.push({
      id: z.id, type: 'zone', position: { x: x - 60, y: y }, draggable: false,
      data: {
        label: z.label, temp: z.temp, setpoint: z.setpoint, deadband: z.deadband,
        occupancy: z.occupancy, alert: z.alert, integration_score: z.integration_score,
        bim_asset_id: z.bim_asset_id
      }
    });

    // Per-zone instrumentation (camera + temp sensor) — secondary detail, kept faint so the
    // HVAC supply path stays the visual hero. Orthogonal (smoothstep) routing avoids the
    // diagonal-spaghetti look of the default bezier edges.
    const cameraId = `camera_${z.id}`;
    nodes.push({ id: cameraId, type: 'camera', position: { x: x + 70, y: y - 18 }, draggable: false, data: {} });
    edges.push({ id: `e-${z.id}-${cameraId}`, source: z.id, target: cameraId, type: 'smoothstep', style: { stroke: 'rgba(255,255,255,0.12)', strokeWidth: 1, strokeDasharray: '2 3' } });

    const sensorId = `sensor_temp_${z.id}`;
    nodes.push({ id: sensorId, type: 'sensor', position: { x: x + 70, y: y + 22 }, draggable: false, data: {} });
    edges.push({ id: `e-${z.id}-${sensorId}`, source: z.id, target: sensorId, type: 'smoothstep', style: { stroke: 'rgba(255,255,255,0.12)', strokeWidth: 1, strokeDasharray: '2 3' } });

    // Electrical feed (panel -> breaker -> zone): a quiet dark-red bus that recedes behind the
    // bright animated air path. smoothstep keeps it a clean right-angle run, not a crossing curve.
    const circuitId = `circuit_${z.id}`;
    nodes.push({ id: circuitId, type: 'circuit', position: { x: x - 105, y: y + 18 }, draggable: false, data: {} });
    edges.push({ id: `e-${panelId}-${circuitId}`, source: panelId, target: circuitId, type: 'smoothstep', style: { stroke: 'rgba(239,68,68,0.22)', strokeWidth: 1 } });
    edges.push({ id: `e-${circuitId}-${z.id}`, source: circuitId, target: z.id, type: 'smoothstep', style: { stroke: 'rgba(239,68,68,0.30)', strokeWidth: 1 } });

    // 3. Topology mapping driven by Brick Schema semantic ontology!
    // Find what feeds this zone in the graph
    const feedsRel = relationships.find(r => r.target === z.id && r.predicate === 'brick:feeds' && r.source.startsWith('vav'));

    if (feedsRel) {
      const vavId = feedsRel.source;
      const v = simState.vavs[vavId];
      if (v) {
        // Draw the VAV node
        nodes.push({
          id: v.id, type: 'vav', position: { x: x - 15, y: y - 80 }, draggable: false,
          data: { label: v.id.toUpperCase(), flow: (v.flow || 0).toFixed(1) + ' m³/m' }
        });
        
        // Find what feeds the VAV (usually the AHU)
        const ahuRel = relationships.find(r => r.target === v.id && r.predicate === 'brick:feeds');
        const sourceAhu = ahuRel ? ahuRel.source : 'ahu-main';

        edges.push({ id: `e-${sourceAhu}-${v.id}`, source: sourceAhu, target: v.id, type: 'smoothstep', animated: true, className, style: edgeStyle, markerEnd, data: { isFlow: true } });
        edges.push({ id: `e-${v.id}-${z.id}`, source: v.id, target: z.id, type: 'smoothstep', animated: true, className, style: edgeStyle, markerEnd, data: { isFlow: true } });
      }
    } else {
      // Fallback if no relationship found
      edges.push({ id: `e-ahu-${z.id}`, source: 'ahu-main', target: z.id, type: 'smoothstep', animated: true, className, style: edgeStyle, markerEnd, data: { isFlow: true } });
    }
  });

  return { nodes, edges };
};



// The floor that "needs attention" when the dashboard opens: the one holding the default
// critical asset (a server room, via DEFAULT_FAULT_TARGET). Data-driven so a regenerated
// building-data.json just works — no hard-coded level.
const ATTENTION_FLOOR = (() => {
  const f = buildingData.floors.find(fl => fl.zones.some(z => z.zoneId === DEFAULT_FAULT_TARGET));
  return f ? f.level : (buildingData.floors[Math.floor(buildingData.floors.length / 2)]?.level || 1);
})();

function App() {
  const [activeFloor, setActiveFloor] = useState(ATTENTION_FLOOR);
  const [selectedZone, setSelectedZone] = useState(null);
  const [showAiModal, setShowAiModal] = useState(false);
  const [panelSize, setPanelSize] = useState({ w: 600, h: 400 });
  const [airflowSize, setAirflowSize] = useState({ w: 560, h: 380 });
  const [rightPanelWidth, setRightPanelWidth] = useState(360);
  const [activeLeftTab, setActiveLeftTab] = useState('ai');
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(true);
  const [leftPanelSize, setLeftPanelSize] = useState({ w: 360 });
  const [showWindSim, setShowWindSim] = useState(true);
  const [maintenanceTarget, setMaintenanceTarget] = useState(null);
  const [ontology, setOntology] = useState(null);
  const [viewMode, setViewMode] = useState('hybrid');
  const ontologyRef = useRef(null);

  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [liveLogs, setLiveLogs] = useState([]);
  const logEndRef = useRef(null);
  const activeFloorRef = useRef(activeFloor);

  useEffect(() => {
    fetch('http://localhost:8080/api/ontology')
      .then(res => res.json())
      .then(data => { setOntology(data); ontologyRef.current = data; })
      .catch(err => console.error("Failed to load Brick ontology:", err));
  }, []);

  // Kick the 3D canvas after mount so it paints on load. The main building <Canvas> fills a
  // 100vw/vh wrapper that can measure 0 during initial layout, leaving R3F's render loop idle
  // until something forces a re-measure (previously: toggling airflow). A couple of resize
  // pulses make it size + start drawing without any interaction.
  useEffect(() => {
    const ids = [60, 250, 600].map(ms => setTimeout(() => window.dispatchEvent(new Event('resize')), ms));
    return () => ids.forEach(clearTimeout);
  }, []);

  const onSimUpdate = useCallback((newSimData, currentScenario) => {
    setNodes(nds => nds.map(n => {
      if (n.type === 'zone' && newSimData.zones[n.id]) {
          return { ...n, data: { ...n.data, temp: newSimData.zones[n.id].temp.toFixed(1), alert: newSimData.zones[n.id].alert } };
      }
      if (n.type === 'vav' && newSimData.vavs[n.id]) {
          return { ...n, data: { ...n.data, flow: newSimData.vavs[n.id].flow.toFixed(1) + ' m³/m' } };
      }
      if (n.type === 'ahu') {
          return { ...n, data: { ...n.data, pressure: newSimData.ahuPressure } };
      }
      return n;
    }));

    setEdges(eds => eds.map(e => {
      if (!e.data?.isFlow) return e;
      const isFault = currentScenario === 'fault';
      const isRem = currentScenario === 'remediating';
      const gradientId = isFault ? 'flow-fault' : (isRem ? 'flow-rem' : 'flow-nominal');
      const markerColor = isFault ? 'var(--accent-red)' : (isRem ? 'var(--accent-yellow)' : 'var(--accent-green)');
      
      return {
         ...e,
         className: !isFault ? 'edge-flow-vector-fast' : 'edge-flow-vector',
         style: { ...e.style, stroke: `url(#${gradientId})`, strokeDasharray: isFault ? '4 4' : '5 5' },
         markerEnd: { type: MarkerType.ArrowClosed, color: markerColor }
      };
    }));
  }, []);

  const onNodesChange = useCallback((changes) => setNodes((nds) => applyNodeChanges(changes, nds)), []);
  const onEdgesChange = useCallback((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), []);

  const {
    simData,
    initialData,
    activeScenario,
    autoPilot,
    setAutoPilot,
    faultTarget,
    setFaultTarget,
    loadHistory,
    globalMetrics,
    loadScenario,
    sendManualOverride,
    aiForecast
  } = useDigitalTwin(onSimUpdate);

  const executeRemediation = () => {
    setShowAiModal(false);
    loadScenario('remediating');
    setTimeout(() => {
      loadScenario('peak');
    }, 8000);
  };

  // When activeFloor changes or ontology loads, completely rebuild the topology
  useEffect(() => {
    activeFloorRef.current = activeFloor;
    // NOTE: In the original App.jsx, buildTopologyFromSim needs simData.
    // We pass simData to it to build initial nodes
    // Wait, buildTopologyFromSim is defined below this component? Yes.
    // We can just use simData directly.
    const topo = buildTopologyFromSim(simData, activeFloor, ontology);
    setNodes(topo.nodes);
    setEdges(topo.edges);
  }, [activeFloor, ontology]); // Only rebuild on floor or ontology change

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [liveLogs]);

  const failingZone = (activeScenario === 'fault' || activeScenario === 'remediating') && faultTarget
    ? (simData.zones[faultTarget] || { label: faultTarget, temp: 0 }) 
    : Object.values(simData.zones).find(z => z.alert === true || z.alert === 'REMEDIATING') || { label: 'Unknown Zone', temp: 0 };

  const selectedNode = nodes.find(n => n.selected);

  return (
    <div className="hud-container">
      
      <div className="three-d-canvas-wrapper">
        <CanvasErrorBoundary>
          <BuildingModel
            simState={simData}
            activeFloor={activeFloor}
            onFloorClick={setActiveFloor}
            showAirflow={showWindSim}
            selectedZone={selectedZone}
            setSelectedZone={(zoneId) => {
              setSelectedZone(zoneId);
              setFaultTarget(zoneId);
            }}
            viewMode={viewMode}
          />
        </CanvasErrorBoundary>
      </div>

      {/* AI INTERACTIVE MODAL (Non-blocking so user can watch the building fail) */}
      {showAiModal && (
        <div style={{ position: 'absolute', top: '24px', left: '24px', zIndex: 50 }}>
          <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--accent-red)', padding: '2rem', width: '450px', boxShadow: '0 10px 30px rgba(255,0,0,0.2)' }}>
            <h2 style={{ color: 'var(--accent-red)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 0 }}>
              <AlertTriangle size={24} /> ALARM DETECTED
            </h2>
            <p style={{ color: 'var(--text-primary)', lineHeight: 1.5, fontFamily: 'monospace' }}>
              ERR: THERMAL_RUNAWAY<br/>
              LOCATION: {failingZone ? failingZone.label : 'Unknown Zone'}<br/>
              ASSET: {failingZone ? failingZone.bim_asset_id : '---'}
            </p>
            <div style={{ background: '#000', padding: '1rem', margin: '1.5rem 0', border: '1px solid var(--border-glass)' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--accent-blue)', textTransform: 'uppercase', letterSpacing: '1px' }}>AI Override Recommendation</span>
              <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-secondary)', fontFamily: 'monospace', lineHeight: 1.4 }}>
                The system detects critical thermal runaway.<br/>
                Would you like AI Auto-Pilot to automatically alleviate the problem by routing 100% cooling capacity to {failingZone ? failingZone.label : 'this specific room'}?
              </p>
            </div>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
              <button className="cmd-btn" onClick={() => setShowAiModal(false)}>IGNORE</button>
              <button className="cmd-btn active-fault" onClick={executeRemediation} style={{ background: 'var(--accent-red)' }}>EXECUTE RECOMMENDATION</button>
            </div>
          </div>
        </div>
      )}

      {/* LAYER 5: Micro-HUD for Drill-down */}
      {selectedZone && simData.zones[selectedZone] && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 40
        }}>
          {/* Cinematic Overlay gradient */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'radial-gradient(circle, transparent 30%, rgba(0,0,0,0.85) 100%)' }} />
          
          <div style={{
            position: 'absolute', top: '25%', right: '25%',
            background: 'rgba(10,10,10,0.95)', border: '1px solid var(--accent-blue)',
            padding: '1.5rem', borderRadius: '12px', width: '320px', pointerEvents: 'auto',
            boxShadow: '0 0 40px rgba(0, 163, 224, 0.15)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border-glass)', paddingBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '12px', color: 'var(--text-primary)', letterSpacing: '1px' }}>MICRO-TELEMETRY: {simData.zones[selectedZone].label.toUpperCase()}</h3>
              <button onClick={() => setSelectedZone(null)} style={{ background: 'transparent', border: '1px solid var(--accent-red)', borderRadius: '4px', padding: '4px 8px', color: 'var(--accent-red)', cursor: 'pointer', fontSize: '10px', fontWeight: 'bold' }}>EXIT [X]</button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}><Users size={14}/> Est. CO₂ Level</span>
                <span style={{ color: 'var(--accent-green)', fontFamily: 'monospace', fontWeight: 'bold', fontSize: '14px' }}>
                  {(simData.zones[selectedZone].occupancy * 15) + 400} ppm
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}><Activity size={14}/> Thermostat</span>
                <span style={{ color: 'var(--accent-blue)', fontFamily: 'monospace', fontWeight: 'bold', fontSize: '14px' }}>
                  {simData.zones[selectedZone].temp.toFixed(1)}°C / {simData.zones[selectedZone].setpoint.toFixed(1)}°C
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}><Zap size={14}/> Est. Cost Rate</span>
                <span style={{ color: 'var(--accent-yellow)', fontFamily: 'monospace', fontWeight: 'bold', fontSize: '14px' }}>
                  ${(simData.zones[selectedZone].load * 0.12).toFixed(2)} / hr
                </span>
              </div>
              {/* [GEMINI IMPLEMENTATION START] */}
              {/* Added by Gemini (Antigravity) on June 2026. */}
              {/* Added a Manual Veto section to the Micro-Telemetry panel */}
              {/* to allow operators to override the autonomous system. */}
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-secondary)', alignSelf: 'center' }}>MANUAL VETO:</span>
                <button onClick={() => sendManualOverride('LIGHTS_OFF;SETPOINT=26.0', selectedZone)} style={{ flex: 1, background: 'rgba(0,0,0,0.5)', border: '1px solid var(--accent-blue)', color: 'var(--accent-blue)', fontSize: '10px', padding: '6px', cursor: 'pointer', borderRadius: '4px', fontWeight: 'bold' }}>FORCE OFF</button>
                <button onClick={() => sendManualOverride('LIGHTS_ON;SETPOINT=20.0', selectedZone)} style={{ flex: 1, background: 'rgba(0,0,0,0.5)', border: '1px solid var(--accent-red)', color: 'var(--accent-red)', fontSize: '10px', padding: '6px', cursor: 'pointer', borderRadius: '4px', fontWeight: 'bold' }}>MAX COOL</button>
              </div>
              {/* [GEMINI IMPLEMENTATION END] */}
            </div>
          </div>
        </div>
      )}

      {/* LAYER 1: React Flow Topology in Bottom Right Corner */}
      <div 
        className="minimap-wrapper" 
        style={{ 
          position: 'absolute', width: panelSize.w, height: panelSize.h, bottom: '90px', right: '24px', padding: 0, overflow: 'visible', zIndex: 10
        }}
      >
        <div 
          className="resize-handle" 
          onPointerDown={(e) => {
            e.preventDefault();
            const startW = panelSize.w;
            const startH = panelSize.h;
            const startX = e.clientX;
            const startY = e.clientY;
            const onPointerMove = (moveEvent) => {
              const dx = startX - moveEvent.clientX;
              const dy = startY - moveEvent.clientY;
              setPanelSize({
                w: Math.max(360, Math.min(startW + dx, window.innerWidth * 0.9)),
                h: Math.max(260, Math.min(startH + dy, window.innerHeight * 0.9))
              });
            };
            const onPointerUp = () => {
              document.removeEventListener('pointermove', onPointerMove);
              document.removeEventListener('pointerup', onPointerUp);
            };
            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
          }}
          style={{
            position: 'absolute', top: -10, left: -10, width: 20, height: 20, background: 'var(--accent-blue)', 
            cursor: 'nwse-resize', zIndex: 100, borderRadius: '50%', border: '2px solid #000'
          }} 
        />
        <div className="topology-panel" style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', borderRadius: '12px', border: '1px solid var(--border-glass)', background: 'var(--bg-panel)' }}>
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
                 {showWindSim ? '⏸ HIDE AIRFLOW' : '🌬 SHOW AIRFLOW'}
              </button>
              <span style={{ fontSize: '10px', color: 'var(--accent-blue)' }}>{nodes.length - 1} ACTIVE NODES</span>
            </div>
          </div>

          <UIErrorBoundary name="Topology Map">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(e, node) => {
              if (node.type === 'zone') setSelectedZone(node.id);
            }}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            proOptions={{ hideAttribution: true }}
            minZoom={0.1}
            maxZoom={1.5}
            translateExtent={[[-1600, -800], [1600, 800]]}
            nodesDraggable={false}
          >
            <Background gap={40} size={1} color="rgba(255,255,255,0.05)" />
            
            {/* SVG Defs for Airflow Vector Gradients */}
            <svg style={{ position: 'absolute', width: 0, height: 0 }}>
              <defs>
                <linearGradient id="flow-nominal" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#10b981" />
                </linearGradient>
                <linearGradient id="flow-fault" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#ef4444" />
                </linearGradient>
                <linearGradient id="flow-rem" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#eab308" />
                </linearGradient>
              </defs>
            </svg>
          </ReactFlow>
          </UIErrorBoundary>
        </div>
      </div>

      {/* Standalone, resizable airflow window (its own WebGL canvas), toggled by the
          "SHOW/HIDE AIRFLOW" control in the topology header. */}
      {showWindSim && (
        <AirflowWindow
          floor={buildingData.floors.find(f => f.level === activeFloor)}
          activeFloor={activeFloor}
          simState={simData}
          size={airflowSize}
          setSize={setAirflowSize}
          onClose={() => setShowWindSim(false)}
          right={24}
          bottom={90 + panelSize.h + 12}
        />
      )}

      {/* LAYER 4: AI & TELEMETRY (Left Dock) */}
      <div style={{ position: 'absolute', top: '1.5rem', left: '1.5rem', zIndex: 50, display: 'flex', gap: '8px', maxHeight: 'calc(100vh - 3rem)' }}>
        <button 
           onClick={() => setIsLeftPanelOpen(!isLeftPanelOpen)}
           style={{ 
             background: 'var(--bg-panel)', border: '1px solid var(--border-glass)', color: 'var(--text-primary)', 
             borderRadius: '12px', padding: '12px', cursor: 'pointer', height: 'fit-content', display: 'flex', alignItems: 'center'
           }}
        >
          <Activity size={20} color="var(--accent-blue)" />
        </button>

        {isLeftPanelOpen && (
          <div style={{ width: leftPanelSize.w, height: 'calc(100vh - 3rem)', background: 'var(--bg-panel)', border: '1px solid var(--border-glass)', borderRadius: '12px', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
            <div 
              className="resize-handle" 
              onPointerDown={(e) => {
                e.preventDefault();
                const startW = leftPanelSize.w;
                const startX = e.clientX;
                const onPointerMove = (moveEvent) => {
                  const dx = moveEvent.clientX - startX;
                  setLeftPanelSize({
                    w: Math.max(280, Math.min(startW + dx, window.innerWidth * 0.5)),
                  });
                };
                const onPointerUp = () => {
                  document.removeEventListener('pointermove', onPointerMove);
                  document.removeEventListener('pointerup', onPointerUp);
                };
                document.addEventListener('pointermove', onPointerMove);
                document.addEventListener('pointerup', onPointerUp);
              }}
              style={{
                position: 'absolute', top: '50%', right: 0, transform: 'translateY(-50%)', width: 10, height: 40, cursor: 'ew-resize', zIndex: 100
              }} 
            />
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-glass)' }}>
              <button 
                onClick={() => setActiveLeftTab('ai')}
                style={{ flex: 1, padding: '12px', background: activeLeftTab === 'ai' ? 'rgba(0, 163, 224, 0.1)' : 'transparent', color: activeLeftTab === 'ai' ? 'var(--accent-blue)' : 'var(--text-secondary)', border: 'none', borderBottom: activeLeftTab === 'ai' ? '2px solid var(--accent-blue)' : 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '10px' }}
              >
                AI INSIGHTS
              </button>
              <button 
                onClick={() => setActiveLeftTab('telemetry')}
                style={{ flex: 1, padding: '12px', background: activeLeftTab === 'telemetry' ? 'rgba(0, 163, 224, 0.1)' : 'transparent', color: activeLeftTab === 'telemetry' ? 'var(--accent-blue)' : 'var(--text-secondary)', border: 'none', borderBottom: activeLeftTab === 'telemetry' ? '2px solid var(--accent-blue)' : 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '10px' }}
              >
                PROFILER
              </button>
              <button 
                onClick={() => setActiveLeftTab('logs')}
                style={{ flex: 1, padding: '12px', background: activeLeftTab === 'logs' ? 'rgba(0, 163, 224, 0.1)' : 'transparent', color: activeLeftTab === 'logs' ? 'var(--accent-blue)' : 'var(--text-secondary)', border: 'none', borderBottom: activeLeftTab === 'logs' ? '2px solid var(--accent-blue)' : 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '10px' }}
              >
                LOGS
              </button>
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
              {activeLeftTab === 'logs' ? (
                <TelemetryLogs simData={simData} />
              ) : activeLeftTab === 'telemetry' ? (
                <TelemetryPanel 
                  simData={simData} 
                  loadHistory={loadHistory}
                  activeScenario={activeScenario}
                  faultTarget={faultTarget}
                  onOpenMaintenance={() => setMaintenanceTarget(failingZone ? failingZone.bim_asset_id : null)}
                  autoPilot={autoPilot}
                />
              ) : (
                <AiInsightsPanel 
                  simData={simData} 
                  activeScenario={activeScenario} 
                  faultTarget={faultTarget} 
                  aiForecast={aiForecast}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* LAYER 2: Global Metrics (Right Dock) */}
      <GlobalMetricsPanel
        simData={simData}
        globalMetrics={globalMetrics}
        loadHistory={loadHistory}
        activeScenario={activeScenario}
        selectedNode={selectedNode}
        activeFloor={activeFloor}
        width={rightPanelWidth}
        setWidth={setRightPanelWidth}
        sendManualOverride={sendManualOverride}
      />

      {maintenanceTarget && (
        <MaintenanceDrawer
          zoneId={maintenanceTarget}
          simData={simData}
          onClose={() => setMaintenanceTarget(null)}
        />
      )}

      {/* VIEW MODE TOGGLE (Floating Top Center-Left) */}
      <div style={{
        position: 'absolute',
        top: '1.5rem',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 20,
        display: 'flex', 
        gap: '4px', 
        background: 'rgba(0,0,0,0.6)', 
        padding: '4px', 
        borderRadius: '8px', 
        border: '1px solid var(--border-glass)',
        backdropFilter: 'blur(10px)'
      }}>
        <button 
          onClick={() => setViewMode('physical')}
          style={{ padding: '6px 12px', fontSize: '11px', borderRadius: '4px', border: 'none', cursor: 'pointer', background: viewMode === 'physical' ? 'var(--accent-blue)' : 'transparent', color: viewMode === 'physical' ? '#fff' : 'var(--text-secondary)', fontWeight: 'bold' }}
        >
          PHYSICAL
        </button>
        <button 
          onClick={() => setViewMode('hybrid')}
          style={{ padding: '6px 12px', fontSize: '11px', borderRadius: '4px', border: 'none', cursor: 'pointer', background: viewMode === 'hybrid' ? 'var(--accent-blue)' : 'transparent', color: viewMode === 'hybrid' ? '#fff' : 'var(--text-secondary)', fontWeight: 'bold' }}
        >
          HYBRID
        </button>
        <button 
          onClick={() => setViewMode('logical')}
          style={{ padding: '6px 12px', fontSize: '11px', borderRadius: '4px', border: 'none', cursor: 'pointer', background: viewMode === 'logical' ? 'var(--accent-blue)' : 'transparent', color: viewMode === 'logical' ? '#fff' : 'var(--text-secondary)', fontWeight: 'bold' }}
        >
          LOGICAL
        </button>
      </div>

      {/* COMMAND BAR (Floating Bottom Center) */}
      <div className="hud-command-bar">
        <button 
          className={`cmd-btn ${activeScenario === 'peak' ? 'active-peak' : ''}`} 
          onClick={() => loadScenario('peak')}
        >
          <Zap size={16} /> Peak Load
        </button>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', background: 'rgba(0,0,0,0.3)', padding: '0 0.5rem', borderRadius: '12px' }}>
          <select 
            value={faultTarget}
            onChange={(e) => setFaultTarget(e.target.value)}
            style={{ background: 'transparent', color: 'var(--text-secondary)', border: 'none', padding: '0.5rem', outline: 'none', fontFamily: 'Inter', fontSize: '12px', cursor: 'pointer' }}
          >
            {FAULT_ZONES.map(z => (
              <option key={z.id} value={z.id}>{z.label}</option>
            ))}
          </select>
          <button
            className={`cmd-btn ${activeScenario === 'fault' ? 'active-fault' : ''}`}
            onClick={() => loadScenario(`fault:${faultTarget}`, (level) => setActiveFloor(level))}
            style={{ paddingLeft: '0.5rem' }}
          >
            <AlertTriangle size={16} /> Inject
          </button>
        </div>

        <button 
          className={`cmd-btn ${autoPilot ? 'active-auto' : ''}`} 
          onClick={() => setAutoPilot(!autoPilot)}
        >
          <Settings size={16} /> AI: {autoPilot ? 'ON' : 'OFF'}
        </button>
      </div>

    </div>
  );
}

export default App;
