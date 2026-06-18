import React, { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { physicsEngine } from './simulationEngine';

// --- PingPong FBO Manager ---
class PingPongFBO {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    
    // We use HalfFloatType instead of FloatType for better WebGL compatibility while maintaining precision
    const options = {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      // Linear filtering gives smooth bilinear backtrace during advection
      // (WebGL2 supports half-float linear sampling).
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false
    };
    
    this.texture1 = new THREE.WebGLRenderTarget(width, height, options);
    this.texture2 = new THREE.WebGLRenderTarget(width, height, options);
    
    this.current = this.texture1;
    this.previous = this.texture2;
  }

  swap() {
    const temp = this.current;
    this.current = this.previous;
    this.previous = temp;
  }

  dispose() {
    this.texture1.dispose();
    this.texture2.dispose();
  }
}

// --- GLSL Shaders from Perplexity Research ---

const fullscreenVertex = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const advectionShader = `
  precision highp float;
  varying vec2 vUv;
  uniform float dt;
  uniform sampler2D velocity;
  uniform sampler2D sourceTex;
  uniform vec2 texelSize;

  void main() {
    // Semi-Lagrangian advection. Velocity is already in UV/sec units, so we must
    // NOT scale by texelSize (that made transport ~256x too weak -> static blobs).
    vec2 vel = texture2D(velocity, vUv).xy;
    vec2 pos = vUv - dt * vel;
    vec4 advected = texture2D(sourceTex, pos);
    gl_FragColor = advected * 0.992; // light damping prevents numerical explosion
  }
`;

const divergenceShader = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D velocity;
  uniform vec2 texelSize;

  void main() {
    float L = texture2D(velocity, vUv - vec2(texelSize.x, 0.0)).x;
    float R = texture2D(velocity, vUv + vec2(texelSize.x, 0.0)).x;
    float T = texture2D(velocity, vUv + vec2(0.0, texelSize.y)).y;
    float B = texture2D(velocity, vUv - vec2(0.0, texelSize.y)).y;

    float div = 0.5 * (R - L + T - B);
    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
  }
`;

const jacobiShader = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D pressure;
  uniform sampler2D divergence;
  uniform vec2 texelSize;

  void main() {
    float L = texture2D(pressure, vUv - vec2(texelSize.x, 0.0)).x;
    float R = texture2D(pressure, vUv + vec2(texelSize.x, 0.0)).x;
    float T = texture2D(pressure, vUv + vec2(0.0, texelSize.y)).x;
    float B = texture2D(pressure, vUv - vec2(0.0, texelSize.y)).x;

    float div = texture2D(divergence, vUv).x;
    
    float pNew = (L + R + B + T - div) * 0.25;
    gl_FragColor = vec4(pNew, 0.0, 0.0, 1.0);
  }
`;

const gradientShader = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D velocity;
  uniform sampler2D pressure;
  uniform vec2 texelSize;

  void main() {
    float L = texture2D(pressure, vUv - vec2(texelSize.x, 0.0)).x;
    float R = texture2D(pressure, vUv + vec2(texelSize.x, 0.0)).x;
    float T = texture2D(pressure, vUv + vec2(0.0, texelSize.y)).x;
    float B = texture2D(pressure, vUv - vec2(0.0, texelSize.y)).x;

    vec2 vel = texture2D(velocity, vUv).xy;
    vel.xy -= 0.5 * vec2(R - L, T - B);
    
    gl_FragColor = vec4(vel, 0.0, 1.0);
  }
`;

const forceSplatShader = `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 diffuserPos;
  uniform vec3 colorForce; // (u, v, temp)
  uniform float radius;
  uniform sampler2D baseTex;

  void main() {
    vec4 base = texture2D(baseTex, vUv);
    float dist = distance(vUv, diffuserPos);
    float splat = exp(-dist * dist / radius);
    
    base.rgb += colorForce * splat;
    gl_FragColor = base;
  }
`;

const displayShader = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D velocity;
  uniform sampler2D temperature;

  void main() {
    vec2 vel = texture2D(velocity, vUv).xy;
    float temp = texture2D(temperature, vUv).z; // temp stored in z channel
    float speed = length(vel);

    // Diverging palette: cool air = blue, neutral = teal, server heat = red.
    vec3 cold = vec3(0.10, 0.55, 1.00);
    vec3 mid  = vec3(0.00, 0.80, 0.70);
    vec3 hot  = vec3(1.00, 0.25, 0.10);

    float nt = clamp(temp / 18.0, -1.0, 1.0); // signed: <0 cooling, >0 heating
    vec3 color = (nt >= 0.0) ? mix(mid, hot, nt) : mix(mid, cold, -nt);

    // Flow highlights so streaks/curls read clearly
    color += vec3(speed * 1.6);

    // Alpha floor keeps the field visible as a living fluid, not a black box
    float alpha = clamp(speed * 5.0 + abs(nt) * 0.9 + 0.12, 0.0, 0.95);
    gl_FragColor = vec4(color, alpha);
  }
`;


// --- Simulation Component ---
function FluidSolver() {
  const { gl } = useThree();
  const resolution = 256;
  
  // FBOs
  const fboVelocity = useMemo(() => new PingPongFBO(resolution, resolution), []);
  const fboPressure = useMemo(() => new PingPongFBO(resolution, resolution), []);
  const fboColor = useMemo(() => new PingPongFBO(resolution, resolution), []); // RGB = (u, v, temp)
  const fboDivergence = useMemo(() => new THREE.WebGLRenderTarget(resolution, resolution, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }), []);
  
  // Scene for rendering FBOs
  const fboScene = useMemo(() => new THREE.Scene(), []);
  const fboCamera = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), []);
  const quadMesh = useMemo(() => new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), []);
  
  useEffect(() => {
    fboScene.add(quadMesh);
  }, [fboScene, quadMesh]);

  // Materials
  const materials = useMemo(() => {
    const texelSize = new THREE.Vector2(1.0 / resolution, 1.0 / resolution);
    return {
      advection: new THREE.ShaderMaterial({
        vertexShader: fullscreenVertex, fragmentShader: advectionShader,
        uniforms: { dt: { value: 0.016 }, texelSize: { value: texelSize }, velocity: { value: null }, sourceTex: { value: null } }
      }),
      divergence: new THREE.ShaderMaterial({
        vertexShader: fullscreenVertex, fragmentShader: divergenceShader,
        uniforms: { texelSize: { value: texelSize }, velocity: { value: null } }
      }),
      jacobi: new THREE.ShaderMaterial({
        vertexShader: fullscreenVertex, fragmentShader: jacobiShader,
        uniforms: { texelSize: { value: texelSize }, pressure: { value: null }, divergence: { value: null } }
      }),
      gradient: new THREE.ShaderMaterial({
        vertexShader: fullscreenVertex, fragmentShader: gradientShader,
        uniforms: { texelSize: { value: texelSize }, velocity: { value: null }, pressure: { value: null } }
      }),
      splat: new THREE.ShaderMaterial({
        vertexShader: fullscreenVertex, fragmentShader: forceSplatShader,
        uniforms: { diffuserPos: { value: new THREE.Vector2() }, colorForce: { value: new THREE.Vector3() }, radius: { value: 0.001 }, baseTex: { value: null } }
      }),
      display: new THREE.ShaderMaterial({
        vertexShader: fullscreenVertex, fragmentShader: displayShader, transparent: true,
        uniforms: { velocity: { value: null }, temperature: { value: null } }
      })
    };
  }, []);

  const renderPass = (material, target) => {
    quadMesh.material = material;
    gl.setRenderTarget(target);
    gl.render(fboScene, fboCamera);
    gl.setRenderTarget(null);
  };

  useFrame((state, delta) => {
    // 1. Fetch simulation state (HVAC flow & Server Heat)
    const simState = physicsEngine.getState();
    const serverVavFlow = simState.vavs['vav-server-6a']?.flow || 0;
    const serverTemp = simState.zones['zone-server-6a']?.temp || 24.0;
    
    const dt = Math.min(delta, 0.033);
    this._t = (this._t || 0) + dt;
    // Always-on baseline so the diffuser/plume read even when server load is low
    const vavStrength = Math.max(serverVavFlow, 6.0);
    const heat = Math.max(serverTemp - 24.0, 4.0);

    // --- FORCES (Inject HVAC & Heat) ---
    // Cold supply jet from the VAV diffuser (top-left), flowing down-right
    materials.splat.uniforms.diffuserPos.value.set(0.22, 0.80);
    materials.splat.uniforms.colorForce.value.set(vavStrength * 0.04, -vavStrength * 0.04, 0.0);
    materials.splat.uniforms.radius.value = 0.016;
    materials.splat.uniforms.baseTex.value = fboVelocity.previous.texture;
    renderPass(materials.splat, fboVelocity.current);
    fboVelocity.swap();

    // Cold air lowers temperature (negative -> blue)
    materials.splat.uniforms.baseTex.value = fboColor.previous.texture;
    materials.splat.uniforms.colorForce.value.set(0.0, 0.0, -vavStrength * 0.10);
    renderPass(materials.splat, fboColor.current);
    fboColor.swap();

    // Rising heat plume from the servers (center), buoyant upward
    materials.splat.uniforms.diffuserPos.value.set(0.5, 0.42);
    materials.splat.uniforms.colorForce.value.set(Math.sin(this._t * 1.7) * 0.01, 0.018, 0.0);
    materials.splat.uniforms.radius.value = 0.030;
    materials.splat.uniforms.baseTex.value = fboVelocity.previous.texture;
    renderPass(materials.splat, fboVelocity.current);
    fboVelocity.swap();

    materials.splat.uniforms.baseTex.value = fboColor.previous.texture;
    materials.splat.uniforms.colorForce.value.set(0.0, 0.0, heat * 0.06);
    renderPass(materials.splat, fboColor.current);
    fboColor.swap();

    // --- ADVECTION ---
    materials.advection.uniforms.dt.value = dt;
    materials.advection.uniforms.velocity.value = fboVelocity.previous.texture;
    
    // Advect Velocity
    materials.advection.uniforms.sourceTex.value = fboVelocity.previous.texture;
    renderPass(materials.advection, fboVelocity.current);
    fboVelocity.swap();
    
    // Advect Color/Temp
    materials.advection.uniforms.sourceTex.value = fboColor.previous.texture;
    renderPass(materials.advection, fboColor.current);
    fboColor.swap();

    // --- DIVERGENCE ---
    materials.divergence.uniforms.velocity.value = fboVelocity.previous.texture;
    renderPass(materials.divergence, fboDivergence);

    // --- JACOBI PRESSURE SOLVER ---
    materials.jacobi.uniforms.divergence.value = fboDivergence.texture;
    for (let i = 0; i < 20; i++) {
      materials.jacobi.uniforms.pressure.value = fboPressure.previous.texture;
      renderPass(materials.jacobi, fboPressure.current);
      fboPressure.swap();
    }

    // --- GRADIENT SUBTRACTION ---
    materials.gradient.uniforms.velocity.value = fboVelocity.previous.texture;
    materials.gradient.uniforms.pressure.value = fboPressure.previous.texture;
    renderPass(materials.gradient, fboVelocity.current);
    fboVelocity.swap();

    // --- DISPLAY ---
    // Update the mesh material that is rendered to screen
    materials.display.uniforms.velocity.value = fboVelocity.previous.texture;
    materials.display.uniforms.temperature.value = fboColor.previous.texture;
  });

  // The display material uses a clip-space (fullscreen) vertex shader, so the
  // mesh transform is irrelevant and Three.js must NOT frustum-cull it — without
  // this the quad gets culled against the ortho frustum and the panel goes black.
  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <primitive object={materials.display} attach="material" />
    </mesh>
  );
}

export default function WindSimulationCanvas() {
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 5, overflow: 'hidden' }}>
      <Canvas orthographic camera={{ zoom: 15, position: [0, 50, 0] }}>
        <FluidSolver />
      </Canvas>
    </div>
  );
}
