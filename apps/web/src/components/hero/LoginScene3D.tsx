"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

/**
 * The sign-in scene: a luminous protective shell around a floating medical
 * cross, with an orbiting data ring.
 *
 * Deliberately smaller and calmer than the landing hero. This sits beside a form
 * that people need to read and use, so it must not compete with it — lower
 * particle count, capped pixel ratio, no autorotate fast enough to draw the eye,
 * and it stops rendering entirely when it scrolls out of view or when the
 * visitor has asked for reduced motion.
 */

function MedicalCross() {
  const group = useRef<THREE.Group>(null);

  // A real cross profile extruded and bevelled, rather than two intersecting
  // boxes: the bevel catches the light along every arm and reads as a solid
  // object instead of a boolean accident.
  const shape = useMemo(() => {
    const arm = 0.17; // half-width of an arm
    const len = 0.54; // half-length of the cross
    const s = new THREE.Shape();
    s.moveTo(-arm, len);
    s.lineTo(arm, len);
    s.lineTo(arm, arm);
    s.lineTo(len, arm);
    s.lineTo(len, -arm);
    s.lineTo(arm, -arm);
    s.lineTo(arm, -len);
    s.lineTo(-arm, -len);
    s.lineTo(-arm, -arm);
    s.lineTo(-len, -arm);
    s.lineTo(-len, arm);
    s.lineTo(-arm, arm);
    s.closePath();
    return s;
  }, []);

  const geometry = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: 0.16,
      bevelEnabled: true,
      bevelThickness: 0.028,
      bevelSize: 0.028,
      bevelSegments: 3,
      curveSegments: 4,
    });
    g.center();
    return g;
  }, [shape]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state) => {
    if (!group.current) return;
    const t = state.clock.getElapsedTime();
    // A slow breath and a gentle tilt. Small enough to feel alive, not busy.
    group.current.rotation.y = Math.sin(t * 0.28) * 0.42;
    group.current.rotation.x = Math.sin(t * 0.21) * 0.13;
    group.current.position.y = Math.sin(t * 0.5) * 0.045;
  });

  return (
    <group ref={group}>
      <mesh geometry={geometry}>
        <meshPhysicalMaterial
          color="#0E2438"
          metalness={0.55}
          roughness={0.18}
          clearcoat={1}
          clearcoatRoughness={0.12}
          emissive="#38D9FF"
          emissiveIntensity={0.42}
        />
      </mesh>
      {/* A slightly larger wireframe shell, so the cross reads as holographic. */}
      <mesh geometry={geometry} scale={1.055}>
        <meshBasicMaterial color="#57E6B1" wireframe transparent opacity={0.13} />
      </mesh>
    </group>
  );
}

function ProtectiveShell() {
  const inner = useRef<THREE.Mesh>(null);
  const outer = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (inner.current) {
      inner.current.rotation.y = t * 0.09;
      inner.current.rotation.z = t * 0.04;
    }
    if (outer.current) {
      outer.current.rotation.y = -t * 0.055;
      outer.current.rotation.x = t * 0.03;
      const pulse = 1 + Math.sin(t * 0.9) * 0.012;
      outer.current.scale.setScalar(pulse);
    }
  });

  return (
    <group>
      {/* Luminous core */}
      <mesh>
        <sphereGeometry args={[0.62, 48, 48]} />
        <meshPhysicalMaterial
          color="#07111F"
          metalness={0.2}
          roughness={0.08}
          clearcoat={1}
          emissive="#1D6E8C"
          emissiveIntensity={0.55}
          transparent
          opacity={0.92}
        />
      </mesh>
      {/* Inner lattice */}
      <mesh ref={inner}>
        <icosahedronGeometry args={[0.95, 2]} />
        <meshBasicMaterial color="#38D9FF" wireframe transparent opacity={0.16} />
      </mesh>
      {/* Outer protective sphere */}
      <mesh ref={outer}>
        <sphereGeometry args={[1.28, 40, 40]} />
        <meshBasicMaterial color="#A8E9FF" wireframe transparent opacity={0.075} />
      </mesh>
    </group>
  );
}

function DataRing({ radius, tilt, color, speed }: { radius: number; tilt: number; color: string; speed: number }) {
  const ref = useRef<THREE.Group>(null);
  const nodes = useMemo(() => {
    const out: { pos: [number, number, number]; r: number }[] = [];
    const count = 7;
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2;
      out.push({ pos: [Math.cos(a) * radius, 0, Math.sin(a) * radius], r: i % 2 === 0 ? 0.036 : 0.024 });
    }
    return out;
  }, [radius]);

  useFrame((state) => {
    if (ref.current) ref.current.rotation.y = state.clock.getElapsedTime() * speed;
  });

  return (
    <group ref={ref} rotation={[tilt, 0, tilt * 0.4]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius, 0.006, 8, 128]} />
        <meshBasicMaterial color={color} transparent opacity={0.34} />
      </mesh>
      {nodes.map((n, i) => (
        <mesh key={i} position={n.pos}>
          <sphereGeometry args={[n.r, 16, 16]} />
          <meshBasicMaterial color={color} transparent opacity={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function Particles({ count = 70 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null);

  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      // Distributed in a shell so nothing clutters the centre of the composition.
      const r = 1.6 + Math.random() * 1.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.7;
      arr[i * 3 + 2] = r * Math.cos(phi);
    }
    return arr;
  }, [count]);

  useFrame((state) => {
    if (ref.current) ref.current.rotation.y = state.clock.getElapsedTime() * 0.018;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} count={count} />
      </bufferGeometry>
      <pointsMaterial size={0.022} color="#A8E9FF" transparent opacity={0.5} sizeAttenuation depthWrite={false} />
    </points>
  );
}

function CameraRig({ enabled }: { enabled: boolean }) {
  const target = useRef({ x: 0, y: 0 });

  useFrame((state, delta) => {
    if (!enabled) return;
    const cam = state.camera;
    cam.position.x += (target.current.x * 0.34 - cam.position.x) * Math.min(delta * 1.3, 1);
    cam.position.y += (target.current.y * 0.22 - cam.position.y) * Math.min(delta * 1.3, 1);
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

export function LoginScene3D({ className, reducedMotion = false }: { className?: string; reducedMotion?: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  // Stop rendering when off-screen: an invisible WebGL loop is pure battery burn.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setVisible(entries[0]?.isIntersecting ?? true), {
      threshold: 0.01,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Render the placeholder box on the server and first paint so layout never shifts.
  if (!mounted) return <div className={className} aria-hidden="true" />;

  return (
    <div ref={containerRef} className={className} aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0.15, 3.35], fov: 42 }}
        dpr={[1, 1.6]}
        frameloop={visible && !reducedMotion ? "always" : "demand"}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      >
        <ambientLight intensity={0.45} />
        <directionalLight position={[3, 4, 3.5]} intensity={1.05} color="#A8E9FF" />
        <directionalLight position={[-3.5, -2, 2]} intensity={0.5} color="#57E6B1" />
        <pointLight position={[0, 0, 1.6]} intensity={0.7} color="#38D9FF" />

        <ProtectiveShell />
        <MedicalCross />
        <DataRing radius={1.62} tilt={0.42} color="#38D9FF" speed={0.16} />
        <DataRing radius={1.9} tilt={-0.66} color="#57E6B1" speed={-0.11} />
        <Particles count={reducedMotion ? 0 : 70} />
        <CameraRig enabled={!reducedMotion} />

        {!reducedMotion && (
          <OrbitControls enableZoom={false} enablePan={false} enableRotate={false} autoRotate autoRotateSpeed={0.32} />
        )}
      </Canvas>
    </div>
  );
}

export default LoginScene3D;
