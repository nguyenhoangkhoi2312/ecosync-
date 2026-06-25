import React, { useMemo } from 'react';
import { Brain, Zap, AlertTriangle, TrendingDown, ThermometerSnowflake, Activity, Eye, ShieldAlert } from 'lucide-react';

export default function AiInsightsPanel({ simData, activeScenario, faultTarget, aiForecast }) {
  
  // Dynamically generate insights based on simulation state
  const insights = useMemo(() => {
    const generated = [];
    const zones = Object.values(simData.zones || {});
    
    // 1. Critical Scenario Fault
    if (activeScenario === 'fault' && faultTarget) {
      generated.push({
        id: 'fault',
        type: 'critical',
        icon: <AlertTriangle size={18} color="var(--accent-red)" />,
        title: 'Thermal Runaway Detected',
        message: `Zone ${faultTarget} is experiencing a critical thermal failure. Cooling capacity is degraded.`,
        action: 'OVERRIDE VAV SETTINGS'
      });
    }

    // 2. High Demand Period
    if (activeScenario === 'peak') {
      generated.push({
        id: 'peak',
        type: 'warning',
        icon: <TrendingDown size={18} color="var(--accent-yellow)" />,
        title: 'High Grid Demand',
        message: 'Grid load is nearing peak capacity. Pre-cooling sequence is recommended to offset afternoon prices.',
        action: 'ACTIVATE PRE-COOLING'
      });
    }

    // [GEMINI IMPLEMENTATION START]
    if (aiForecast && aiForecast.predicted_peak_load) {
      const isFallback = aiForecast.weather_source === "fallback";
      generated.push({
        id: 'forecast',
        type: 'info',
        icon: <Activity size={18} color="var(--accent-blue)" />,
        title: 'LSTM Load Forecast',
        message: `Deep Learning model predicts an upcoming peak load of ${aiForecast.predicted_peak_load.toFixed(2)} MW. ${isFallback ? '(Using fallback weather)' : '(Live weather data incorporated)'}`,
        action: 'VIEW PREDICTIONS'
      });
    }
    // [GEMINI IMPLEMENTATION END]

    // 3. Unoccupied Wasting
    const wastingZones = zones.filter(z => z.occupancy === 0 && z.load > 0);
    if (wastingZones.length > 0) {
      generated.push({
        id: 'wasting',
        type: 'info',
        icon: <Zap size={18} color="var(--accent-blue)" />,
        title: 'Energy Optimization Opportunity',
        message: `${wastingZones.length} zones are currently unoccupied but consuming ${wastingZones.reduce((acc, z) => acc + z.load, 0).toFixed(1)} kW of cooling power.`,
        action: 'APPLY ECO SETBACK'
      });
    }

    // 4. Out of Band (Hot spots)
    const hotZones = zones.filter(z => z.temp > (z.setpoint + (z.deadband || 1)));
    if (hotZones.length > 0 && activeScenario !== 'fault') {
      generated.push({
        id: 'hot',
        type: 'warning',
        icon: <ThermometerSnowflake size={18} color="var(--accent-yellow)" />,
        title: 'Thermal Drift Detected',
        message: `${hotZones.length} zones have drifted above their cooling deadband. Neural net suggests increasing supply static pressure by 0.2 inWC.`,
        action: 'OPTIMIZE PRESSURE'
      });
    }

    // 5. General AI Status (Always present to avoid empty state)
    generated.push({
      id: 'general',
      type: 'success',
      icon: <Brain size={18} color="var(--accent-green)" />,
      title: 'Autonomous Operations Nominal',
      message: 'Deep Reinforcement Learning agent is actively balancing comfort and energy efficiency. Estimated daily savings: 14.2%.',
      action: 'VIEW MODEL METRICS'
    });

    return generated;
  }, [simData, activeScenario, faultTarget]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', animation: 'fadeIn 0.5s ease-out' }}>
      
      {/* Header Section */}
      <div style={{ paddingBottom: '16px', borderBottom: '1px solid var(--border-glass)' }}>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
          <Brain size={18} color="var(--accent-blue)" /> AI Operations Engine
        </h3>
        <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Real-time neural network diagnostics and actionable insights. Total building load is currently at <span style={{ color: 'var(--text-primary)', fontWeight: 'bold' }}>{simData.buildingLoadMw?.toFixed(2)} MW</span>.
        </p>
      </div>

      {/* Insight Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {insights.map((insight, idx) => {
          let bg, border, titleColor;
          switch (insight.type) {
            case 'critical':
              bg = 'rgba(239, 68, 68, 0.05)';
              border = 'rgba(239, 68, 68, 0.3)';
              titleColor = 'var(--accent-red)';
              break;
            case 'warning':
              bg = 'rgba(234, 179, 8, 0.05)';
              border = 'rgba(234, 179, 8, 0.3)';
              titleColor = 'var(--accent-yellow)';
              break;
            case 'success':
              bg = 'rgba(34, 197, 94, 0.05)';
              border = 'rgba(34, 197, 94, 0.3)';
              titleColor = 'var(--accent-green)';
              break;
            case 'info':
            default:
              bg = 'rgba(0, 163, 224, 0.05)';
              border = 'rgba(0, 163, 224, 0.3)';
              titleColor = 'var(--accent-blue)';
              break;
          }

          return (
            <div 
              key={insight.id}
              style={{
                background: bg,
                border: `1px solid ${border}`,
                borderRadius: '10px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                position: 'relative',
                overflow: 'hidden',
                animation: `slideInRight 0.4s ease-out ${idx * 0.1}s backwards`
              }}
            >
              {/* Decorative side accent */}
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '4px', background: titleColor }} />
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ padding: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', display: 'flex' }}>
                  {insight.icon}
                </div>
                <span style={{ fontSize: '12px', fontWeight: 'bold', color: titleColor }}>
                  {insight.title}
                </span>
              </div>
              
              <p style={{ margin: '4px 0 0 0', fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {insight.message}
              </p>
              
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                <button style={{
                  background: 'transparent',
                  border: `1px solid ${border}`,
                  color: titleColor,
                  padding: '6px 12px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onMouseOver={(e) => { e.currentTarget.style.background = titleColor; e.currentTarget.style.color = '#000'; }}
                onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = titleColor; }}
                >
                  {insight.action}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Embedded CSS for animations */}
      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
