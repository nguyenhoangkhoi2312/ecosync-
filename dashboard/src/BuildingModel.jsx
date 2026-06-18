import React, { useRef, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html, Edges } from '@react-three/drei';
import * as THREE from 'three';
import { Evaluator, Brush, SUBTRACTION } from 'three-bvh-csg';
import buildingData from './building-data.json';

// ========== CSG Helper (three-bvh-csg Evaluator/Brush API) ==========
// three-bvh-csg has no static `CSG` helper; it exposes an Evaluator that
// operates on Brush meshes whose world matrices define their placement.
const csgEvaluator = new Evaluator();
csgEvaluator.attributes = ['position', 'normal'];

function meshToBrush(mesh) {
  mesh.updateMatrix();
  const brush = new Brush(mesh.geometry);
  brush.position.copy(mesh.position);
  brush.quaternion.copy(mesh.quaternion);
  brush.scale.copy(mesh.scale);
  brush.updateMatrixWorld(true);
  return brush;
}

// Subtract one or more tool meshes from a base mesh; returns baked geometry
// in the base mesh's transformed (world) space, matching the old CSG.toMesh.
function csgSubtract(baseMesh, toolMeshes) {
  if (!toolMeshes || toolMeshes.length === 0) {
    baseMesh.updateMatrix();
    return baseMesh.geometry.clone().applyMatrix4(baseMesh.matrix);
  }
  let result = meshToBrush(baseMesh);
  toolMeshes.forEach((tool) => {
    result = csgEvaluator.evaluate(result, meshToBrush(tool), SUBTRACTION);
  });
  return result.geometry;
}

// ========== Module-level CSG geometry cache ==========
// CSG is expensive and the tower has only ~5 distinct floor shapes across its
// 14 levels (the 8 typical-office floors are identical). Keying the result on a
// structural signature means each unique wall/plate runs CSG exactly once and
// the geometry is shared by every floor that matches — cutting initial CSG cost
// by ~3x. Geometries live for the app lifetime (bounded set), so no disposal is
// needed; the cache itself prevents the unbounded-leak case.
const _geometryCache = new Map();
function getCachedGeometry(signature, build) {
  let geom = _geometryCache.get(signature);
  if (!geom) {
    geom = build();
    _geometryCache.set(signature, geom);
  }
  return geom;
}

// ========== STEP 1: CSG-Based Wall with Window Cutouts ==========
function WallWithWindows({ position: [x, y, z], width, height, depth, rotation, windows = [], isActive }) {
  const meshRef = useRef();
  
  const wallGeometry = useMemo(() => {
    const signature = `wall|${width}|${height}|${depth}|${JSON.stringify(windows)}`;
    return getCachedGeometry(signature, () => {
      const wallBox = new THREE.BoxGeometry(width, height, depth);
      wallBox.translate(0, height / 2, 0); // Bake the Y shift into the geometry directly!
      const wallMesh = new THREE.Mesh(wallBox);

      const windowMeshes = windows.map((window) => {
        const windowBox = new THREE.BoxGeometry(window.width, window.height, depth + 0.5);
        windowBox.translate(window.x, window.y, 0); // Bake local window pos into geometry!
        const windowMesh = new THREE.Mesh(windowBox);
        return windowMesh;
      });

      return csgSubtract(wallMesh, windowMeshes);
    });
  }, [width, height, depth, windows]);
  
  return (
    <mesh
      ref={meshRef}
      position={[x, y, z]}
      rotation={[0, -rotation, 0]}
      geometry={wallGeometry}
      dispose={null}
    >
      <meshStandardMaterial 
        color={isActive ? "#888888" : "#222222"}
        roughness={0.8}
        metalness={0.2}
        transparent={!isActive}
        opacity={isActive ? 1.0 : 0.15}
        polygonOffset={true}
        polygonOffsetFactor={1}
      />
      <Edges color={isActive ? "#ffffff" : "#444444"} threshold={15} />
    </mesh>
  );
}

// ========== STEP 2: Exterior Walls Generator ==========
function ExteriorWalls({ floor, isActive }) {
  const walls = useMemo(() => {
    const polygon = floor.geometry.exteriorPolygon;
    const wallSegments = [];
    
    for (let i = 0; i < polygon.length; i++) {
      const start = polygon[i];
      const end = polygon[(i + 1) % polygon.length];
      
      // Convert from 2D coordinates [x, y] to 3D [x, 0, -z] centered around (20, 20)
      const sx = start[0] - 20;
      const sz = -start[1] + 20;
      const ex = end[0] - 20;
      const ez = -end[1] + 20;

      const width = Math.sqrt((ex - sx) ** 2 + (ez - sz) ** 2);
      const angle = Math.atan2(ez - sz, ex - sx);
      
      const windowSpacing = floor.floorType === 'typical-office' ? 4.0 : 6.0;
      const windows = [];
      let currentX = windowSpacing / 2;
      while (currentX < width - windowSpacing / 2) {
        windows.push({
          x: currentX - width / 2,
          y: 1.0 + (floor.height - 1.5) / 2, // Bottom sill at 1m from floor
          width: 2.0,
          height: floor.height - 1.5,
        });
        currentX += windowSpacing;
      }

      wallSegments.push({
        position: [(sx + ex) / 2, 0, (sz + ez) / 2],
        width,
        height: floor.height,
        depth: floor.geometry.wallThickness,
        rotation: angle,
        windows: windows,
      });
    }
    
    return wallSegments;
  }, [floor]);
  
  return (
    <group>
      {walls.map((wall, idx) => (
        <WallWithWindows
          key={`wall-${idx}`}
          position={wall.position}
          width={wall.width}
          height={wall.height}
          depth={wall.depth}
          rotation={wall.rotation}
          windows={wall.windows}
          isActive={isActive}
        />
      ))}
    </group>
  );
}

// ========== STEP 3: Floor Plate with Core Cutout ==========
function FloorPlate({ floor, isActive, onClick }) {
  const [hovered, setHovered] = useState(false);

  const geometry = useMemo(() => {
    const g = floor.geometry;
    const signature = `plate_native|${JSON.stringify(g.exteriorPolygon)}|${JSON.stringify(g.corePolygon)}|${g.wallThickness}`;
    return getCachedGeometry(signature, () => {
      const exteriorShape = new THREE.Shape();
      g.exteriorPolygon.forEach((p, idx) => {
        if (idx === 0) exteriorShape.moveTo(p[0] - 20, p[1] - 20);
        else exteriorShape.lineTo(p[0] - 20, p[1] - 20);
      });
      exteriorShape.lineTo(g.exteriorPolygon[0][0] - 20, g.exteriorPolygon[0][1] - 20);

      // Natively subtract the core hole (No CSG needed, solves triangulation artifacts!)
      if (g.corePolygon && g.corePolygon.length > 0) {
        const corePath = new THREE.Path();
        g.corePolygon.forEach((p, idx) => {
          if (idx === 0) corePath.moveTo(p[0] - 20, p[1] - 20);
          else corePath.lineTo(p[0] - 20, p[1] - 20);
        });
        corePath.lineTo(g.corePolygon[0][0] - 20, g.corePolygon[0][1] - 20);
        exteriorShape.holes.push(corePath);
      }

      const exteriorGeom = new THREE.ExtrudeGeometry(exteriorShape, {
        depth: g.wallThickness,
        bevelEnabled: false,
      });
      
      // Bake rotation and Y shift into the geometry
      exteriorGeom.rotateX(-Math.PI / 2);
      exteriorGeom.translate(0, -g.wallThickness, 0);

      // Return perfectly indexed geometry to prevent EdgesGeometry from drawing internal diagonals
      return exteriorGeom;
    });
  }, [floor]);
  
  return (
    <group>
      <mesh
        geometry={geometry}
        dispose={null}
        onClick={(e) => { e.stopPropagation(); onClick(floor.level); }}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto'; }}
      >
        <meshStandardMaterial 
          color={isActive ? "#dddddd" : hovered ? "#555555" : "#333333"}
          roughness={0.9}
          transparent={!isActive}
          opacity={isActive ? 1.0 : hovered ? 0.6 : 0.3}
          polygonOffset={true}
          polygonOffsetFactor={2}
        />
        <Edges color={isActive ? "#ffffff" : hovered ? "#00ffff" : "#444444"} threshold={15} />
      </mesh>

      {/* Floating Live Data Label */}
      <Html position={[-25, floor.height / 2, 20]} center zIndexRange={[100, 0]} style={{ transition: 'opacity 0.2s', opacity: isActive || hovered ? 1 : 0.2, pointerEvents: 'none' }}>
        <div style={{ color: isActive ? '#fff' : hovered ? '#00ffff' : '#aaa', background: 'rgba(0,0,0,0.85)', border: `1px solid ${isActive ? '#fff' : hovered ? '#00ffff' : '#333'}`, padding: '6px 12px', fontSize: '11px', fontFamily: 'monospace', whiteSpace: 'nowrap', textShadow: '0 0 5px rgba(0,229,255,0.5)' }}>
          <strong style={{ fontSize: '12px' }}>[ L{floor.level} ]</strong><br/>
          {floor.name}<br/>
          <span style={{ color: '#00e5ff' }}>ZONES: {floor.zones.length}</span>
        </div>
      </Html>
    </group>
  );
}

// ========== STEP 4: Zone Renderer with Thermal Heatmap ==========
function ZoneRenderer({ zone, simState }) {
  const zoneSim = simState.zones[zone.zoneId];
  const temperature = zoneSim ? zoneSim.temp : zone.thermalProperties.setpoint;
  const setpoint = zone.thermalProperties.setpoint;
  const deadband = zone.thermalProperties.deadband;

  // Height by footprint so overlapping/nested zones don't z-fight: large
  // "container" zones (e.g. a cold-aisle corridor spanning the whole floor)
  // become a low wash, while smaller rooms step up and read as distinct volumes.
  const area = zone.area || 400;
  const baseH = zone.zoneType === 'corridor' ? 0.4 : 2.0;
  const zoneHeight = baseH + Math.max(0, 1 - Math.min(area, 1000) / 1000) * 2.0;

  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    zone.polygon.forEach((p, idx) => {
      if (idx === 0) shape.moveTo(p[0] - 20, p[1] - 20);
      else shape.lineTo(p[0] - 20, p[1] - 20);
    });
    shape.lineTo(zone.polygon[0][0] - 20, zone.polygon[0][1] - 20);
    
    const geom = new THREE.ExtrudeGeometry(shape, {
      depth: zoneHeight,
      bevelThickness: 0.05,
      bevelSize: 0.05,
      bevelSegments: 3,
      curveSegments: 12,
    });

    // Bake the -90° X rotation into the vertices so the zone lies FLAT on the
    // floor plate and extrudes upward. (Previously the rotation was set on a
    // throwaway mesh and never baked, so zones rendered as vertical slabs.)
    geom.rotateX(-Math.PI / 2);
    geom.computeVertexNormals();
    return geom.toNonIndexed();
  }, [zone, zoneHeight]);

  // Shader to render heatmap
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        temperature: { value: temperature },
        setpoint: { value: setpoint },
        deadband: { value: deadband },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float temperature;
        uniform float setpoint;
        uniform float deadband;
        varying vec2 vUv;
        
        vec3 heatmap(float value) {
          // Blue -> Cyan -> Green -> Yellow -> Red
          float r = clamp(2.0 * value - 1.0, 0.0, 1.0);
          float g = clamp(2.0 - 2.0 * abs(value - 0.5), 0.0, 1.0);
          float b = clamp(1.0 - 2.0 * value, 0.0, 1.0);
          return vec3(r, g, b);
        }
        
        void main() {
          float deviation = (temperature - setpoint) / deadband;
          // Map -2 (too cold) to 0, +2 (too hot) to 1. 0 deviation is 0.5 (green)
          float normalized = clamp((deviation / 4.0) + 0.5, 0.0, 1.0);
          gl_FragColor = vec4(heatmap(normalized), 0.85); // slight transparency
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
  }, []);

  // Update uniform dynamically without recreating material
  useFrame(() => {
    if (material && material.uniforms.temperature) {
      const liveTemp = simState.zones[zone.zoneId]?.temp || setpoint;
      material.uniforms.temperature.value = liveTemp;
    }
  });

  return (
    <group>
      <mesh geometry={geometry} material={material} />
      
      {/* Label for Zone */}
      <Html position={[zone.centroid.x - 20, zoneHeight + 0.2, -(zone.centroid.y - 20)]} center zIndexRange={[100, 0]} sprite>
        <div style={{ color: '#fff', fontSize: '10px', fontFamily: 'monospace', whiteSpace: 'nowrap', userSelect: 'none', background: 'rgba(0,0,0,0.8)', padding: '4px 6px', border: '1px solid #333' }}>
          {zone.name}<br/>
          <span style={{ color: '#aaa' }}>{temperature.toFixed(1)}°C</span>
        </div>
      </Html>
    </group>
  );
}

function floorHeightFromType(type) {
  if (type === 'mechanical') return 4.0;
  if (type === 'lobby') return 4.5;
  if (type === 'server-room') return 3.2;
  return 2.8;
}

// ========== STEP 5: Complete Production Building Component ==========
export default function BuildingModel({ simState, activeFloor, onFloorClick }) {
  const floors = buildingData.floors;

  // Calculate total height to center building
  let totalHeight = 0;
  const floorHeights = floors.map(f => {
    const currentHeight = totalHeight;
    totalHeight += f.height;
    return currentHeight;
  });

  return (
    <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 1 }}>
      <Canvas camera={{ position: [50, 40, 50], fov: 45 }}>
        <color attach="background" args={['#000000']} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 20, 10]} intensity={1.2} />
        
        <OrbitControls target={[0, 15, 0]} />

        <group position={[0, 0, 0]}>
          {floors.map((floor, idx) => {
            const isActive = activeFloor === floor.level;
            const yPos = floorHeights[idx];

            return (
              <group key={floor.floorId} position={[0, yPos, 0]}>
                <FloorPlate floor={floor} isActive={isActive} onClick={onFloorClick} />

                {/* Walls + interior zones only on the active floor: keeps the
                    stacked dim plates as a clean tower silhouette while the
                    selected floor reads clearly (also fewer draw calls). */}
                {isActive && <ExteriorWalls floor={floor} isActive={isActive} />}
                {isActive && floor.zones.map(zone => (
                  <ZoneRenderer key={zone.zoneId} zone={zone} simState={simState} />
                ))}
              </group>
            );
          })}
        </group>
        
        {/* Helper Grid */}
        <gridHelper args={[100, 100, '#333333', '#111111']} position={[0, -0.1, 0]} />
      </Canvas>
    </div>
  );
}
