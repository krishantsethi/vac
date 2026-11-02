"use client";

import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Floating data node drifting slowly around the shield
function DataNode({ x, y, z, radius = 0.05, color = "#38D9FF" }: any) {
  const meshRef = useRef<THREE.Mesh>(null);
  const time = useRef(Math.random() * 10);
  useFrame((_, delta) => {
    if (!meshRef.current) return;
    time.current += delta * 0.5;
    meshRef.current.position.y = y + Math.sin(time.current) * 0.12;
    meshRef.current.position.x = x + Math.cos(time.current * 0.7) * 0.08;
    meshRef.current.rotation.z += 0.015;
    meshRef.current.rotation.y += 0.01;
  });
  return (
    <mesh ref={meshRef} position={[x, y, z]}>
      <icosahedronGeometry args={[radius, 0]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={1.6}
        transparent
        opacity={0.9}
      />
    </mesh>
  );
}

// Thin connection line from the verified core to a record node
function LinkLine({ start, end, color = "#38D9FF" }: any) {
  return (
    <Line
      points={[start, end]}
      color={color}
      lineWidth={1}
      transparent
      opacity={0.35}
    />
  );
}

// DNA-inspired double helix: two offset sine curves with connecting rungs
function Helix({ turns = 2, height = 1.9, radius = 0.42 }: any) {
  const groupRef = useRef<THREE.Group>(null);

  const strandA = useMemo(() => {
    const pts: [number, number, number][] = [];
    const segments = 160;
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * turns * Math.PI * 2;
      pts.push([
        Math.cos(t) * radius,
        -height / 2 + (i / segments) * height,
        Math.sin(t) * radius,
      ]);
    }
    return pts;
  }, [turns, height, radius]);

  const strandB = useMemo(
    () =>
      strandA.map(
        (p) => [-p[0], p[1], -p[2]] as [number, number, number]
      ),
    [strandA]
  );

  // Rungs every Nth point
  const rungs = useMemo(() => {
    const out: { a: [number, number, number]; b: [number, number, number] }[] = [];
    for (let i = 0; i < strandA.length; i += 12) {
      out.push({ a: strandA[i], b: strandB[i] });
    }
    return out;
  }, [strandA, strandB]);

  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.12;
  });

  return (
    <group ref={groupRef}>
      <Line points={strandA} color="#57E6B1" lineWidth={1.4} transparent opacity={0.5} />
      <Line points={strandB} color="#38D9FF" lineWidth={1.4} transparent opacity={0.5} />
      {rungs.map((r, i) => (
        <Line
          key={i}
          points={[r.a, r.b]}
          color="#A8E9FF"
          lineWidth={0.7}
          transparent
          opacity={0.22}
        />
      ))}
    </group>
  );
}

// Translucent protective shield: glass sphere plus two energy rings
function Shield() {
  const sphereRef = useRef<THREE.Mesh>(null);
  const ring1Ref = useRef<THREE.Mesh>(null);
  const ring2Ref = useRef<THREE.Mesh>(null);
  const phase = useRef(0);

  useFrame((_, delta) => {
    phase.current += delta * 0.8;
    const s = 1 + Math.sin(phase.current) * 0.03;
    if (sphereRef.current) sphereRef.current.scale.setScalar(s);
    if (ring1Ref.current) {
      ring1Ref.current.rotation.z += delta * 0.1;
      ring1Ref.current.rotation.x = Math.PI / 2.4;
    }
    if (ring2Ref.current) {
      ring2Ref.current.rotation.z -= delta * 0.07;
      ring2Ref.current.rotation.y = Math.PI / 3;
    }
  });

  return (
    <>
      <mesh ref={sphereRef}>
        <sphereGeometry args={[1.05, 48, 48]} />
        <meshPhysicalMaterial
          color="#38D9FF"
          transparent
          opacity={0.07}
          roughness={0.15}
          metalness={0.1}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={ring1Ref}>
        <torusGeometry args={[1.32, 0.006, 8, 128]} />
        <meshStandardMaterial
          color="#57E6B1"
          emissive="#57E6B1"
          emissiveIntensity={1.2}
          transparent
          opacity={0.55}
        />
      </mesh>
      <mesh ref={ring2Ref}>
        <torusGeometry args={[1.48, 0.004, 8, 128]} />
        <meshStandardMaterial
          color="#38D9FF"
          emissive="#38D9FF"
          emissiveIntensity={1.2}
          transparent
          opacity={0.4}
        />
      </mesh>
    </>
  );
}

// Central luminous core representing verified health information
function Core() {
  const lightRef = useRef<THREE.PointLight>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const time = useRef(0);

  useFrame((_, delta) => {
    time.current += delta * 1.2;
    if (lightRef.current) lightRef.current.intensity = 2.4 + Math.sin(time.current) * 1.1;
    if (glowRef.current) {
      const s = 1 + Math.sin(time.current * 0.9) * 0.08;
      glowRef.current.scale.setScalar(s);
    }
  });

  return (
    <>
      <pointLight ref={lightRef} position={[0, 0, 0]} intensity={3} distance={7} decay={2} color="#38D9FF" />
      <mesh>
        <sphereGeometry args={[0.16, 32, 32]} />
        <meshBasicMaterial color="#FFFFFF" />
      </mesh>
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.3, 32, 32]} />
        <meshStandardMaterial
          color="#38D9FF"
          emissive="#38D9FF"
          emissiveIntensity={2}
          transparent
          opacity={0.28}
          depthWrite={false}
        />
      </mesh>
    </>
  );
}

// Particles travelling along vertical paths inside the shield
function Particles({ count = 120 }: any) {
  const pointsRef = useRef<THREE.Points>(null);
  const { positions, velocities } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = 0.5 + Math.random() * 1.1;
      const theta = Math.random() * Math.PI * 2;
      positions[i * 3] = Math.cos(theta) * r;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 2.4;
      positions[i * 3 + 2] = Math.sin(theta) * r;
      velocities[i] = 0.08 + Math.random() * 0.22;
    }
    return { positions, velocities };
  }, [count]);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, [positions]);

  useFrame((_, delta) => {
    if (!pointsRef.current) return;
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      let y = pos.getY(i) + velocities[i] * delta;
      if (y > 1.2) y = -1.2;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
    pointsRef.current.rotation.y += delta * 0.05;
  });

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial
        color="#A8E9FF"
        transparent
        opacity={0.55}
        size={0.022}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// Subtle pointer-driven camera drift (no forced movement)
function CameraRig({ enabled }: { enabled: boolean }) {
  const target = useRef({ x: 0, y: 0 });
  useFrame((state, delta) => {
    if (!enabled) return;
    const cam = state.camera;
    cam.position.x += (target.current.x * 0.55 - cam.position.x) * Math.min(delta * 1.6, 1);
    cam.position.y += (target.current.y * 0.35 - cam.position.y) * Math.min(delta * 1.6, 1);
    cam.lookAt(0, 0, 0);
  });

  useEffect(() => {
    if (!enabled) return;
    const onMove = (e: PointerEvent) => {
      target.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      target.current.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [enabled]);

  return null;
}

interface Hero3DProps {
  className?: string;
  reducedMotion?: boolean;
}

export function Hero3D({ className, reducedMotion = false }: Hero3DProps) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  // Pause rendering when the scene scrolls out of view
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => setVisible(entries[0]?.isIntersecting ?? true),
      { threshold: 0.01 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (!mounted) return <div className={className} aria-hidden="true" />;

  return (
    <div ref={containerRef} className={className} aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 3.6], fov: 45 }}
        dpr={[1, 1.75]}
        frameloop={visible && !reducedMotion ? "always" : "demand"}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[3, 4, 3]} intensity={0.9} color="#A8E9FF" />
        <directionalLight position={[-3, -2, 2]} intensity={0.4} color="#57E6B1" />

        <Shield />
        <Core />
        <Helix />

        <LinkLine start={[0, 0, 0]} end={[-1.25, 0.62, 0.5]} color="#38D9FF" />
        <LinkLine start={[0, 0, 0]} end={[1.15, -0.45, 0.6]} color="#57E6B1" />
        <LinkLine start={[0, 0, 0]} end={[-0.95, -1.05, 0.35]} color="#38D9FF" />
        <LinkLine start={[0, 0, 0]} end={[1.4, 0.9, 0.2]} color="#57E6B1" />

        <DataNode x={-1.25} y={0.62} z={0.5} radius={0.07} color="#38D9FF" />
        <DataNode x={1.15} y={-0.45} z={0.6} radius={0.06} color="#57E6B1" />
        <DataNode x={-0.95} y={-1.05} z={0.35} radius={0.05} color="#A8E9FF" />
        <DataNode x={1.4} y={0.9} z={0.2} radius={0.065} color="#38D9FF" />
        <DataNode x={0.35} y={1.35} z={0.15} radius={0.05} color="#57E6B1" />
        <DataNode x={-1.5} y={-0.6} z={0.25} radius={0.045} color="#A8E9FF" />

        <Particles count={120} />
        <CameraRig enabled={!reducedMotion} />

        {!reducedMotion && (
          <OrbitControls
            enableZoom={false}
            enablePan={false}
            enableRotate={false}
            autoRotate
            autoRotateSpeed={0.45}
          />
        )}
      </Canvas>
    </div>
  );
}

export default Hero3D;
