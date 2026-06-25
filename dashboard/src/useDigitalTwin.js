import { useState, useEffect, useRef, useMemo } from 'react';
import * as flatbuffers from 'flatbuffers';
import { SimState } from './telemetry';
import buildingData from './building-data.json';

const INTEGRATION_BY_TYPE = {
  'server-room': 1.05,
  'corridor': 0.95,
  'lobby': 0.90,
  'mechanical': 0.85,
  'retail': 0.75,
  'conference': 0.70,
  'office': 0.55,
};

// Data-driven fault targets: derive the selectable zones from the loaded building so any
// regenerated building-data.json "just works" (no hard-coded zoneIds to re-wire).
export const FAULT_ZONES = (() => {
  const zones = [];
  buildingData.floors.forEach(f => f.zones.forEach(z => zones.push({ ...z, level: f.level })));
  const servers = zones.filter(z => z.zoneType === 'server-room');
  const pick = (servers.length ? servers : zones).slice();
  return pick.map(z => ({ id: z.zoneId, label: `L${z.level} ${z.name.replace(/ Level \d+$/, '')}`, type: z.zoneType }));
})();
export const DEFAULT_FAULT_TARGET = FAULT_ZONES[0]?.id || '';

export const getInitialSimData = () => {
  const data = { scenario: 'peak', ahuPressure: 500, buildingLoadMw: 0, systemHealth: 100, totalOccupants: 0, coolingOutputMw: 0, plantCop: 0, energySavedMw: 0, vavs: {}, zones: {}, logs: [] };
  buildingData.floors.forEach(floor => {
    floor.zones.forEach(z => {
      let cx = 20, cy = 20;
      if (z.centroid) {
        cx = z.centroid.x;
        cy = z.centroid.y;
      }
      
      if (z.hvacMapping) {
        data.vavs[z.hvacMapping.vavId] = { id: z.hvacMapping.vavId, targetZone: z.zoneId, flow: 0 };
      }
      data.zones[z.zoneId] = {
        id: z.zoneId,
        level: floor.level,
        label: z.name,
        type: z.zoneType,
        archetype: z.zoneType === 'server-room' ? 'server_room' : 'office_dcv',
        bim_asset_id: z.bim_asset_id,
        temp: z.thermalProperties?.setpoint || 24.0,
        setpoint: z.thermalProperties?.setpoint || 24.0,
        deadband: z.thermalProperties?.deadband || 2.0,
        alert: false,
        occupancy: z.thermalProperties?.occupancy || 0, // real occupancy arrives from the backend stream
        integration_score: INTEGRATION_BY_TYPE[z.zoneType] || 0.6,
        baseHeatGain: z.thermalProperties?.internalHeatLoad || 0,
        centroid: { x: cx, y: cy }
      };
    });
  });
  return data;
};

export function useDigitalTwin(onUpdate) {
  const [activeScenario, setActiveScenario] = useState('peak');
  const [autoPilot, setAutoPilot] = useState(true);
  const [faultTarget, setFaultTargetState] = useState(DEFAULT_FAULT_TARGET);
  const faultTargetRef = useRef(DEFAULT_FAULT_TARGET);
  
  const setFaultTarget = (v) => {
    setFaultTargetState(v);
    faultTargetRef.current = v;
  };
  
  const [loadHistory, setLoadHistory] = useState([]);

  // [GEMINI IMPLEMENTATION START]
  // Fetch TimescaleDB history on mount
  useEffect(() => {
    fetch('http://localhost:8080/api/history')
      .then(res => res.json())
      .then(data => {
        if (data && data.length > 0) {
          setLoadHistory(data);
        }
      })
      .catch(err => console.log('No history DB available:', err));
  }, []);
  // [GEMINI IMPLEMENTATION END]
  
  const initialData = useMemo(() => getInitialSimData(), []);
  const [simData, setSimData] = useState(initialData);
  const simDataRef = useRef(initialData);
  const activeScenarioRef = useRef(activeScenario);
  const lastHistUpdateRef = useRef(0);
  const wsRef = useRef(null);

  // Every value here is real: streamed straight from the Go physics engine's GlobalData
  // (buildingLoadMw, coolingOutputMw, plantCop, energySavedMw, totalOccupants) or computed
  // from the live per-zone temperatures. No fabricated ratios.
  const globalMetrics = useMemo(() => {
    const empty = { occupants: 0, avgTemp: 0, buildingLoadMw: 0, coolingOutputMw: 0, plantCop: 0, energySavedMw: 0, gridPowerMw: 0 };
    if (!simData || !simData.zones) return empty;
    let tempSum = 0;
    const zones = Object.values(simData.zones);
    zones.forEach(z => { tempSum += parseFloat(z.temp) || 24.0; });
    const bldgLoad = simData.buildingLoadMw || 0;
    return {
      occupants: simData.totalOccupants || 0,
      avgTemp: zones.length ? (tempSum / zones.length).toFixed(1) : 0,
      buildingLoadMw: bldgLoad,
      coolingOutputMw: simData.coolingOutputMw || 0, // thermal cooling delivered (MW)
      plantCop: simData.plantCop || 0,               // chiller-plant coefficient of performance
      energySavedMw: simData.energySavedMw || 0,     // saved by occupancy-driven setback
      gridPowerMw: bldgLoad,                          // no on-site generation -> grid = load
    };
  }, [simData]);

  const loadScenario = (key, onFloorJump) => {
    const baseScenario = key.startsWith('fault:') ? 'fault' : key;
    setActiveScenario(baseScenario);
    activeScenarioRef.current = baseScenario;
    
    if (key.startsWith('fault:') && onFloorJump) {
      const zid = key.slice(6);
      const floor = buildingData.floors.find(f => f.zones.some(z => z.zoneId === zid));
      if (floor) {
        onFloorJump(floor.level, zid);
      }
    }
    
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(key);
    }
  };

  // [GEMINI IMPLEMENTATION START]
  // Added by Gemini (Antigravity) on June 2026.
  // Exposes a function for the UI to dispatch manual override JSON payloads
  // via the WebSocket, allowing the user to veto the AI and control edge devices.
  const sendManualOverride = (action, zoneId) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action, zone: zoneId }));
    }
  };
  // [GEMINI IMPLEMENTATION END]

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8080/ws');
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const buf = new flatbuffers.ByteBuffer(new Uint8Array(event.data));
      const state = SimState.getRootAsSimState(buf);
      
      const prevData = simDataRef.current;
      const newSimData = { ...prevData, logs: [] }; // logs handled by TelemetryLogs directly or omitted here if not needed
      newSimData.zones = { ...prevData.zones };
      newSimData.vavs = { ...prevData.vavs };

      const zonesLen = state.zonesLength();
      for(let i = 0; i < zonesLen; i++) {
        const z = state.zones(i);
        const id = z.id();
        if (newSimData.zones[id]) {
            const temp = z.temp();
            let alert = false;
            const isFaultMode = activeScenarioRef.current === 'fault';
            const isRemediatingMode = activeScenarioRef.current === 'remediating';
            
            if (isFaultMode && id === faultTargetRef.current) {
                alert = true;
            } else if (isRemediatingMode && id === faultTargetRef.current) {
                alert = 'REMEDIATING';
            }
            newSimData.zones[id] = { ...newSimData.zones[id], temp, load: z.load(), occupancy: z.occupants(), alert };
        }
      }

      const vavsLen = state.vavsLength();
      for(let i = 0; i < vavsLen; i++) {
        const v = state.vavs(i);
        const id = v.id();
        if (newSimData.vavs[id]) {
            newSimData.vavs[id] = { ...newSimData.vavs[id], flow: v.airflow() };
        }
      }

      const g = state.global();
      if (g) {
        // All real, computed by the Go engine from the live physics state.
        newSimData.buildingLoadMw = g.buildingLoadMw();
        newSimData.systemHealth = g.systemHealth();
        newSimData.totalOccupants = g.totalOccupants();
        newSimData.coolingOutputMw = g.coolingOutputMw();
        newSimData.plantCop = g.plantCop();
        newSimData.energySavedMw = g.energySavedMw();

        const nowMs = Date.now();
        if (nowMs - lastHistUpdateRef.current > 1000) {
          lastHistUpdateRef.current = nowMs;
          setLoadHistory(prev => {
            const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const pwrDraw = Number((g.buildingLoadMw() * 1000).toFixed(1)); // kW
            // CO2 derived from real occupancy (steady-state ventilation balance, ~400 ppm outdoor).
            const avgCo2 = Math.round(400 + g.totalOccupants() * 0.85);
            const newHist = [...prev, { time: timeStr, pwr: pwrDraw, co2: avgCo2 }];
            if (newHist.length > 60) newHist.shift();
            return newHist;
          });
        }
      }

      simDataRef.current = newSimData;
      setSimData(newSimData);
      
      if (onUpdate) {
        onUpdate(newSimData, activeScenarioRef.current);
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, []); // eslint-disable-line

  const [aiForecast, setAiForecast] = useState(null);

  // [GEMINI IMPLEMENTATION START]
  // Fetch AI Forecast periodically
  useEffect(() => {
    const fetchForecast = () => {
      fetch('http://localhost:8080/api/forecast')
        .then(res => {
          if (!res.ok) throw new Error('Forecast unavailable');
          return res.json();
        })
        .then(data => {
          if (data && data.predicted_peak_load) {
            setAiForecast(data);
          }
        })
        .catch(err => console.log('Forecast DB/service unavailable', err));
    };

    fetchForecast(); // initial fetch
    const interval = setInterval(fetchForecast, 30000); // every 30s
    return () => clearInterval(interval);
  }, []);
  // [GEMINI IMPLEMENTATION END]

  return {
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
  };
}
