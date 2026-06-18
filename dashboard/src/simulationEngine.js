import buildingData from './building-data.json';

export const calculateCentroid = (points) => {
  let x = 0, y = 0;
  points.forEach(p => { x += p[0]; y += p[1]; });
  return [x / points.length, y / points.length];
};

// Space-syntax integration score per zone type. The server room is the
// circulation/criticality hub (>1.0 → red), circulation spaces are well
// integrated (>0.8 → green), work spaces are more segregated (blue).
const INTEGRATION_BY_TYPE = {
  'server-room': 1.05,
  'corridor': 0.95,
  'lobby': 0.90,
  'mechanical': 0.85,
  'retail': 0.75,
  'conference': 0.70,
  'office': 0.55,
};

class SimulationEngine {
  constructor() {
    this.time = 0;
    this.scenario = 'peak'; 
    this.ahuPressure = 500; // Pa (Will be dynamically calculated by fan curve)
    
    this.ahuPressure = 500; // Pa 
    this.P_max = 600; 
    this.k_fan = 1 / 100; 

    this.vavs = {};
    this.zones = {};

    buildingData.floors.forEach(floor => {
      floor.zones.forEach(z => {
        // Create VAV from zone mapping
        if (z.hvacMapping) {
          this.vavs[z.hvacMapping.vavId] = {
            id: z.hvacMapping.vavId,
            targetZone: z.zoneId,
            resistance: 1.0, // Base resistance
            flow: 0
          };
        }

        const isServer = z.zoneType === 'server-room';
        this.zones[z.zoneId] = {
          id: z.zoneId,
          level: floor.level,
          label: z.name,
          type: z.zoneType,
          temp: isServer ? 22.0 : 24.0,
          wallTemp: isServer ? 22.0 : 24.0,
          alert: false,
          occupancy: z.thermalProperties.occupancy ?? 0,
          integration_score: INTEGRATION_BY_TYPE[z.zoneType] ?? 0.6,
          baseHeatGain: z.thermalProperties.internalHeatLoad,
          volume: z.volume,
          wallArea: z.wallArea,
          wallThickness: z.thermalProperties.wallThickness,
          setpoint: z.thermalProperties.setpoint,
          centroid: z.centroid
        };
        
        const zone = this.zones[z.zoneId];
        // Capacitances (J/K)
        zone.C_air = 1.202 * 1006 * zone.volume; 
        zone.C_wall = 2400 * 880 * zone.wallArea * zone.wallThickness; // Concrete thermal mass
        // Thermal Resistances (K/W)
        zone.R_in = 1 / (8.3 * zone.wallArea);
        zone.R_out = 1 / (34 * zone.wallArea);
      });
    });

    this.logPool = [];
    this.doHardyCross();
  }

  doHardyCross() {
    // Calculate Equivalent System Resistance for parallel branches
    let sumInvSqrtR = 0;
    Object.values(this.vavs).forEach(vav => {
      sumInvSqrtR += 1 / Math.sqrt(vav.resistance);
    });
    const R_system = 1 / (sumInvSqrtR ** 2);

    // Fan Curve intersection: P_max - k*Q^2 = R_sys*Q^2
    const Q_total_sq = this.P_max / (this.k_fan + R_system);
    this.ahuPressure = R_system * Q_total_sq; // Dynamic system pressure

    // Distribute flows to individual VAVs
    Object.values(this.vavs).forEach(vav => {
      vav.flow = Math.sqrt(Math.max(0, this.ahuPressure) / vav.resistance); // m³/min
    });
  }

  setScenario(s) {
    this.scenario = s;
    if (s === 'fault') {
      this.vavs['vav-server-6a'].resistance = 15.0; // Damper stuck closed
      this.doHardyCross();
      this.pushLog('SKEYSPOT_MAP', 'Graph routing: Primary cooling loop pressure drop detected.', true);
      this.pushLog('VAV_CTRL', 'Core dampers failing to actuate. Airflow restricted.', true);
    } else if (s === 'remediating') {
      this.vavs['vav-server-6a'].resistance = 0.1; // Force damper fully open
      // Close office dampers to divert flow to server room
      Object.keys(this.vavs).forEach(key => {
        if (key !== 'vav-server-6a') this.vavs[key].resistance = 10.0;
      });
      this.doHardyCross();
      this.pushLog('AUTO_PILOT', '[ACTUATION] Engaging secondary bypass valve & closing perimeter VAVs.', false);
    } else {
      // Reset every VAV damper to its base resistance (no hvacTopology block
      // exists in the building data, so fall back to the nominal 1.0).
      Object.values(this.vavs).forEach(vav => {
        vav.resistance = 1.0;
      });
      this.doHardyCross();
    }
  }

  pushLog(source, msg, critical) {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
    this.logPool.push({ id: Date.now() + Math.random(), time: timeStr, source, msg, critical });
    if (this.logPool.length > 50) this.logPool.shift();
  }

  tick(dt) {
    this.time += dt;
    
    // Thermodynamics (2R1C Thermal Network Model via Euler Method)
    Object.values(this.vavs).forEach(vav => {
      const z = this.zones[vav.targetZone];
      if (!z) return; // Ignore zones that aren't loaded (e.g. Lobby VAV on Server Floor)
      
      const supplyTemp = 12.0; // °C
      let coolingKW = 0;
      if (z.temp > supplyTemp) {
        const flow_m3_s = vav.flow / 60.0; // Convert m3/min to m3/s for 1.23 constant
        coolingKW = 1.23 * flow_m3_s * (z.temp - supplyTemp);
      }
      const Q_cooling = coolingKW * 1000;
      const Q_internal = z.baseHeatGain;
      const T_outside = 30.0; // Summer day
      
      // Calculate derivatives
      const dT_air_dt = (
        (z.wallTemp - z.temp) / (z.R_in * z.C_air) +
        (Q_internal - Q_cooling) / z.C_air
      );
      
      const dT_wall_dt = (
        (T_outside - z.wallTemp) / (z.R_out * z.C_wall) -
        (z.wallTemp - z.temp) / (z.R_in * z.C_wall)
      );
      
      z.temp += dT_air_dt * dt;
      z.wallTemp += dT_wall_dt * dt;
      
      // Enforce ASHRAE Limits
      if (z.type === 'server-room') {
        if (z.temp > 25.0) {
            z.alert = this.scenario === 'remediating' ? 'REMEDIATING' : true;
        } else {
            z.alert = false;
        }
      }
    });

    if (Math.random() < 0.2 * dt) {
        if (this.scenario === 'fault' && this.zones['zone-server-6a']) {
            this.pushLog('CNN_IR_ARRAY', `MLX90640: Server-Room anomaly! ${this.zones['zone-server-6a'].temp.toFixed(1)}°C > 25°C.`, true);
        } else if (this.scenario === 'remediating') {
            this.pushLog('LSTM_PREDICT', `Forecast: Core thermal stabilization continuing.`, false);
        } else {
            this.pushLog('BMS_HEARTBEAT', `Nominal telemetry sync. AHU DP: ${this.ahuPressure.toFixed(0)} Pa`, false);
        }
    }
  }

  getState() {
    // Generate Box-Muller Gaussian noise to simulate raw IoT ADC data
    const getNoise = (std) => {
      let u = 0, v = 0;
      while(u === 0) u = Math.random();
      while(v === 0) v = Math.random();
      return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) * std;
    };

    // Deep copy state and inject Gaussian noise
    const noisyZones = {};
    Object.keys(this.zones).forEach(k => {
      const z = this.zones[k];
      noisyZones[k] = { ...z, temp: z.temp + getNoise(0.08) };
    });

    const noisyVavs = {};
    Object.keys(this.vavs).forEach(k => {
      const v = this.vavs[k];
      noisyVavs[k] = { ...v, flow: Math.max(0, v.flow + getNoise(0.2)) };
    });

    return {
      scenario: this.scenario,
      vavs: noisyVavs,
      zones: noisyZones,
      logs: [...this.logPool],
      ahuPressure: this.ahuPressure + getNoise(1.5)
    };
  }
}

export const physicsEngine = new SimulationEngine();
