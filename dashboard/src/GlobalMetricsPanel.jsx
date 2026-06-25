import React from 'react';
import { Activity, Users, Thermometer, Zap, BarChart2 } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area } from 'recharts';

function Sparkline({ data, dataKey, color }) {
  return (
    <div style={{ width: '60px', height: '20px' }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <Area type="monotone" dataKey={dataKey} stroke={color} fill={color} fillOpacity={0.2} strokeWidth={1.5} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function BulletGraph({ label, value, max, target, color, unit }) {
  const numValue = typeof value === 'number' ? value : parseFloat(value) || 0;
  const percent = Math.min(100, (numValue / max) * 100);
  const targetPercent = Math.min(100, (target / max) * 100);
  return (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
        <span>{label}</span>
        <span style={{ fontFamily: 'monospace', fontWeight: 'bold', color: 'var(--text-primary)' }}>{numValue.toFixed(1)} {unit}</span>
      </div>
      <div style={{ position: 'relative', height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
        {/* Safe Range Background */}
        <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: '80%', background: 'rgba(255,255,255,0.02)' }} />
        {/* Actual Value Bar */}
        <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${percent}%`, background: color, transition: 'width 0.3s ease' }} />
        {/* Target Marker */}
        <div style={{ position: 'absolute', top: 0, left: `${targetPercent}%`, height: '100%', width: '2px', background: '#fff', zIndex: 10 }} />
      </div>
    </div>
  );
}

function DeltaCard({ title, icon: Icon, value, unit, delta, isGood, historyData, dataKey, sparkColor }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-glass)', borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-secondary)' }}>
          <Icon size={12} /> {title}
        </div>
        <Sparkline data={historyData} dataKey={dataKey} color={sparkColor} />
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
        <div style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--text-primary)', fontFamily: 'monospace', lineHeight: 1 }}>
          {value} <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{unit}</span>
        </div>
        <div style={{ fontSize: '10px', fontWeight: 'bold', color: isGood ? 'var(--accent-green)' : 'var(--accent-red)', background: isGood ? 'rgba(0,255,0,0.1)' : 'rgba(255,0,0,0.1)', padding: '2px 4px', borderRadius: '4px' }}>
          {delta > 0 ? '▲' : '▼'} {Math.abs(delta)}
        </div>
      </div>
    </div>
  );
}

export default function GlobalMetricsPanel({ simData, globalMetrics, loadHistory, activeFloor, selectedNode, width = 320, setWidth, sendManualOverride }) {
  const [zoneHistory, setZoneHistory] = React.useState([]);

  React.useEffect(() => {
    if (selectedNode?.type === 'zone') {
      fetch(`http://localhost:8080/api/history?zone=${selectedNode.id}`)
        .then(res => res.json())
        .then(data => {
          if (data && data.length > 0) setZoneHistory(data);
        })
        .catch(err => console.log('Zone history error:', err));
    } else {
      setZoneHistory([]);
    }
  }, [selectedNode?.id]);
  
  const bldgLoad = simData.buildingLoadMw ?? 0;
  const sysHealth = simData.systemHealth ?? 100;
  const occupants = simData.totalOccupants ?? 0;

  // Real "active critical faults": zones the live stream has flagged in alarm. This matches the
  // red zones in the 3D model / topology and works regardless of building size (the old
  // sysHealth<80 proxy never tripped once the building grew past ~20 zones).
  const criticalFaults = Object.values(simData.zones || {}).filter(z => z.alert === true).length;
  const hasFault = criticalFaults > 0;
  // Active cooling capacity = current building electrical load vs nameplate design peak, so the
  // bar tracks real plant utilization (rises on peak/fault) instead of a hard-coded constant.
  const DESIGN_PEAK_MW = 3.6;
  const coolingCapacityPct = Math.max(0, Math.min(100, (bldgLoad / DESIGN_PEAK_MW) * 100));

  // Fake delta calculations for demonstration of the professional HMI look
  const loadDelta = +(Math.random() * 0.05).toFixed(2);
  const occDelta = Math.floor(Math.random() * 15);
  
  return (
    <aside className="hud-dock-right" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width, padding: '1rem', position: 'absolute' }}>
      {setWidth && (
        <div
          className="resize-handle"
          onPointerDown={(e) => {
            e.preventDefault();
            const startW = width, startX = e.clientX;
            const onMove = (m) => setWidth(Math.max(280, Math.min(startW + (startX - m.clientX), window.innerWidth * 0.5)));
            const onUp = () => {
              document.removeEventListener('pointermove', onMove);
              document.removeEventListener('pointerup', onUp);
            };
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
          }}
          style={{ position: 'absolute', top: '50%', left: 0, transform: 'translateY(-50%)', width: 10, height: 40, cursor: 'ew-resize', zIndex: 100 }}
        />
      )}
      <div style={{ paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-glass)' }}>
        <h2 style={{ fontSize: '14px', color: 'var(--text-primary)', margin: 0, letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <BarChart2 size={16} color="var(--accent-blue)" />
          {selectedNode ? 'NODE DIAGNOSTICS' : 'ENTERPRISE OVERVIEW'}
        </h2>
        <span className="mono" style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{selectedNode?.id || 'GLOBAL METRICS'}</span>
      </div>

      {!selectedNode ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Delta Cards */}
          <DeltaCard 
            title="TOTAL LOAD" icon={Zap} value={bldgLoad.toFixed(2)} unit="MW" 
            delta={loadDelta} isGood={false} historyData={loadHistory} dataKey="pwr" sparkColor="var(--accent-yellow)" 
          />
          <DeltaCard 
            title="OCCUPANCY" icon={Users} value={occupants} unit="Pax" 
            delta={occDelta} isGood={true} historyData={loadHistory} dataKey="co2" sparkColor="var(--accent-blue)" 
          />

          {/* Bullet Graphs */}
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-glass)', borderRadius: '8px', padding: '16px 12px 4px 12px' }}>
            <BulletGraph label="System Health" value={sysHealth} max={100} target={95} color={sysHealth < 80 ? 'var(--accent-red)' : 'var(--accent-green)'} unit="%" />
            <BulletGraph label="Avg Temperature" value={globalMetrics.avgTemp || 24} max={35} target={23.5} color="var(--accent-blue)" unit="°C" />
            <BulletGraph label="Active Cooling Capacity" value={coolingCapacityPct} max={100} target={60} color="var(--accent-yellow)" unit="%" />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: hasFault ? 'rgba(255,0,0,0.1)' : 'rgba(0,0,0,0.2)', border: hasFault ? '1px solid rgba(255,0,0,0.3)' : '1px solid var(--border-glass)', borderRadius: '8px', alignItems: 'center', transition: '0.3s' }}>
            <div style={{ fontSize: '11px', color: hasFault ? 'var(--accent-red)' : 'var(--text-secondary)', fontWeight: 'bold' }}>ACTIVE CRITICAL FAULTS</div>
            <div style={{ fontSize: '16px', fontWeight: 'bold', color: hasFault ? 'var(--accent-red)' : 'var(--accent-green)' }}>
               {criticalFaults}
            </div>
          </div>

          {/* Static Info */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '8px 12px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
             <span style={{ color: 'var(--text-secondary)' }}>Selected Level:</span>
             <span style={{ color: 'var(--accent-blue)', fontWeight: 'bold' }}>L{activeFloor}</span>
          </div>
        </div>
      ) : selectedNode?.type === 'zone' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>STATUS</span>
            <span style={{ fontSize: '10px', fontWeight: 'bold', padding: '4px 8px', borderRadius: '4px', background: selectedNode.data.alert === true ? 'rgba(255,0,0,0.1)' : 'rgba(0,255,0,0.1)', color: selectedNode.data.alert === true ? 'var(--accent-red)' : 'var(--accent-green)' }}>
              {selectedNode.data.alert === true ? 'ALARM' : 'NOMINAL'}
            </span>
          </div>

          {/* Delta Cards for Zone */}
          <DeltaCard 
            title="LOCAL TEMP" icon={Thermometer} value={parseFloat(selectedNode.data.temp).toFixed(1)} unit="°C" 
            delta={0} isGood={true} historyData={zoneHistory} dataKey="pwr" sparkColor="var(--accent-yellow)" 
          />
          <DeltaCard 
            title="OCCUPANCY" icon={Users} value={selectedNode.data.occupancy} unit="Pax" 
            delta={0} isGood={true} historyData={zoneHistory} dataKey="co2" sparkColor="var(--accent-blue)" 
          />

          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-glass)', borderRadius: '8px', padding: '16px 12px 4px 12px' }}>
            <BulletGraph label="Local Temp" value={parseFloat(selectedNode.data.temp)} max={35} target={24} color={selectedNode.data.alert ? 'var(--accent-red)' : 'var(--accent-yellow)'} unit="°C" />
            <BulletGraph label="Occupancy" value={selectedNode.data.occupancy} max={80} target={20} color="var(--accent-blue)" unit="Pax" />
            <BulletGraph label="Integration Score" value={selectedNode.data.integration_score ?? 0} max={2} target={0.5} color="var(--accent-green)" unit="Idx" />
          </div>

          {/* Manual Override Panel */}
          <div style={{ marginTop: '0.5rem' }}>
             <h3 style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '8px' }}>MANUAL OVERRIDE / VETO</h3>
             <div style={{ display: 'flex', gap: '8px' }}>
               <button 
                 onClick={() => sendManualOverride && sendManualOverride('purge', selectedNode.id)}
                 style={{ flex: 1, padding: '8px', background: 'rgba(255,0,0,0.1)', border: '1px solid var(--accent-red)', color: 'var(--accent-red)', borderRadius: '4px', cursor: 'pointer', fontSize: '10px', fontWeight: 'bold' }}>
                 PURGE
               </button>
               <button 
                 onClick={() => sendManualOverride && sendManualOverride('cool', selectedNode.id)}
                 style={{ flex: 1, padding: '8px', background: 'rgba(0,150,255,0.1)', border: '1px solid var(--accent-blue)', color: 'var(--accent-blue)', borderRadius: '4px', cursor: 'pointer', fontSize: '10px', fontWeight: 'bold' }}>
                 MAX COOL
               </button>
               <button 
                 onClick={() => sendManualOverride && sendManualOverride('reset', selectedNode.id)}
                 style={{ flex: 1, padding: '8px', background: 'rgba(255,255,255,0.1)', border: '1px solid var(--border-glass)', color: 'var(--text-primary)', borderRadius: '4px', cursor: 'pointer', fontSize: '10px', fontWeight: 'bold' }}>
                 RESET
               </button>
             </div>
          </div>
        </div>
      ) : (
        <p style={{ fontSize: '11px', color: 'var(--text-secondary)', textAlign: 'center', marginTop: '2rem' }}>Detailed micro-metrics are only available for Zone nodes.</p>
      )}
    </aside>
  );
}
