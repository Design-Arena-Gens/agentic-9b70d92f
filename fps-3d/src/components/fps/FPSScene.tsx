'use client';

import type { RefObject } from "react";
import { Suspense, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  AdaptiveDpr,
  AdaptiveEvents,
  Cloud,
  Environment,
  GradientTexture,
  Html,
  KeyboardControls,
  KeyboardControlsEntry,
  PointerLockControls,
  Sky,
  Sparkles,
  Stars,
  useKeyboardControls,
} from "@react-three/drei";
import {
  Bloom,
  ChromaticAberration,
  DepthOfField,
  EffectComposer,
  Noise,
  SMAA,
  Vignette,
} from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import {
  BufferAttribute,
  Color,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three";
import type { PointerLockControls as PointerLockControlsImpl } from "three-stdlib";
import { ARENA_HALF_SIZE, clampToArena, terrainHeight } from "@/lib/terrain";
import { usePlayerState } from "@/stores/player";

type ControlName = "forward" | "backward" | "left" | "right" | "run" | "jump" | "crouch";

const CONTROL_MAP: KeyboardControlsEntry<ControlName>[] = [
  { name: "forward", keys: ["ArrowUp", "KeyW"] },
  { name: "backward", keys: ["ArrowDown", "KeyS"] },
  { name: "left", keys: ["ArrowLeft", "KeyA"] },
  { name: "right", keys: ["ArrowRight", "KeyD"] },
  { name: "run", keys: ["ShiftLeft", "ShiftRight"] },
  { name: "jump", keys: ["Space"] },
  { name: "crouch", keys: ["ControlLeft", "KeyC"] },
];

export function FPSScene() {
  const controlsRef = useRef<PointerLockControlsImpl | null>(null);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950">
      <Canvas
        id="fps-canvas"
        shadows
        camera={{ position: [0, 8, 18], fov: 70, near: 0.1, far: 400 }}
        dpr={[1, 1.8]}
      >
        <Suspense fallback={<Preloader />}>
          <KeyboardControls map={CONTROL_MAP}>
            <SceneWorld controlsRef={controlsRef} />
          </KeyboardControls>
        </Suspense>
        <AdaptiveDpr pixelated />
        <AdaptiveEvents />
      </Canvas>
      <HUD controlsRef={controlsRef} />
    </div>
  );
}

function SceneWorld({ controlsRef }: { controlsRef: RefObject<PointerLockControlsImpl | null> }) {
  const setLocked = usePlayerState((state) => state.setLocked);

  return (
    <>
      <color attach="background" args={["#05070f"]} />
      <fog attach="fog" args={["#05070f", 35, 260]} />
      <hemisphereLight args={["#7ba4ff", "#1a1f29", 0.35]} />
      <directionalLight
        castShadow
        intensity={1.1}
        color={new Color("#f4d7b2")}
        position={[80, 120, -35]}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <Environment preset="sunset" ground={{ height: 15, radius: 90, scale: 150 }} />
      <Atmospherics />
      <Terrain />
      <Structures />
      <GlowingRidge />
      <PlayerRig controlsRef={controlsRef} onLockChange={setLocked} />
      <PostFX />
    </>
  );
}

function PlayerRig({
  controlsRef,
  onLockChange,
}: {
  controlsRef: RefObject<PointerLockControlsImpl | null>;
  onLockChange: (locked: boolean) => void;
}) {
  const { camera, gl } = useThree();
  const velocity = useRef(new Vector3());
  const position = useRef(new Vector3(0, 0, 20));
  const stamina = useRef(100);
  const isGrounded = useRef(false);
  const cooldown = useRef(0);
  const heading = useRef(new Quaternion());
  const [, getKeys] = useKeyboardControls<ControlName>();
  const setMetrics = usePlayerState((state) => state.setMetrics);

  const playerHeight = 1.72;
  const crouchHeight = 1.05;
  const walkSpeed = 9.5;
  const gravity = 32;

  const frontVector = new Vector3();
  const sideVector = new Vector3();
  const moveVector = new Vector3();
  const upVector = new Vector3(0, 1, 0);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const controls = controlsRef.current;
    if (!controls) {
      return;
    }

    if (!position.current.lengthSq()) {
      const terrain = terrainHeight(0, 25);
      position.current.set(0, terrain + playerHeight, 25);
    }

    const keys = getKeys();

    heading.current.copy(camera.quaternion);
    frontVector.set(0, 0, -1).applyQuaternion(heading.current).setY(0).normalize();
    sideVector.copy(upVector).cross(frontVector).normalize();

    moveVector.set(0, 0, 0);
    if (keys.forward) moveVector.add(frontVector);
    if (keys.backward) moveVector.sub(frontVector);
    if (keys.left) moveVector.sub(sideVector);
    if (keys.right) moveVector.add(sideVector);

    const isMoving = moveVector.lengthSq() > 0.001;
    if (isMoving) {
      moveVector.normalize();
    }

    const crouchFactor = keys.crouch ? 0.45 : 1;
    const canSprint = keys.run && stamina.current > 5 && !keys.crouch;
    const sprintFactor = canSprint ? 1.75 : 1;
    const targetSpeed = walkSpeed * crouchFactor * sprintFactor;

    if (isMoving) {
      const desiredX = moveVector.x * targetSpeed;
      const desiredZ = moveVector.z * targetSpeed;
      velocity.current.x = MathUtils.damp(velocity.current.x, desiredX, 8, dt);
      velocity.current.z = MathUtils.damp(velocity.current.z, desiredZ, 8, dt);
    } else {
      velocity.current.x = MathUtils.damp(velocity.current.x, 0, 5.5, dt);
      velocity.current.z = MathUtils.damp(velocity.current.z, 0, 5.5, dt);
    }

    if (canSprint && isMoving) {
      stamina.current = Math.max(0, stamina.current - 32 * dt);
    } else {
      stamina.current = Math.min(100, stamina.current + 20 * dt);
    }

    if (cooldown.current > 0) {
      cooldown.current -= dt;
    }

    if (keys.jump && isGrounded.current && cooldown.current <= 0) {
      velocity.current.y = 12.5;
      isGrounded.current = false;
      cooldown.current = 0.35;
    }

    velocity.current.y -= gravity * dt;

    position.current.x += velocity.current.x * dt;
    position.current.z += velocity.current.z * dt;
    position.current.y += velocity.current.y * dt;

    position.current.x = clampToArena(position.current.x, -ARENA_HALF_SIZE + 3, ARENA_HALF_SIZE - 3);
    position.current.z = clampToArena(position.current.z, -ARENA_HALF_SIZE + 3, ARENA_HALF_SIZE - 3);

    const terrainHeightAtPoint = terrainHeight(position.current.x, position.current.z);
    const desiredHeight = keys.crouch
      ? terrainHeightAtPoint + crouchHeight
      : terrainHeightAtPoint + playerHeight;

    if (position.current.y <= desiredHeight) {
      position.current.y = MathUtils.damp(position.current.y, desiredHeight, 18, dt);
      velocity.current.y = 0;
      isGrounded.current = true;
    } else {
      isGrounded.current = false;
    }

    const pointerCamera = (controls as unknown as { camera: typeof camera }).camera;
    pointerCamera.position.copy(position.current);
    camera.position.copy(position.current);

    const horizontalSpeed = Math.sqrt(
      velocity.current.x * velocity.current.x + velocity.current.z * velocity.current.z,
    );
    setMetrics(horizontalSpeed, position.current.y - terrainHeightAtPoint, stamina.current);
  });

  return (
    <PointerLockControls
      ref={controlsRef}
      onLock={() => onLockChange(true)}
      onUnlock={() => onLockChange(false)}
    />
  );
}

function Terrain() {
  const meshRef = useRef<Mesh>(null);
  const geometry = useMemo(() => {
    const plane = new PlaneGeometry(ARENA_HALF_SIZE * 2, ARENA_HALF_SIZE * 2, 320, 320);
    const positions = plane.attributes.position as BufferAttribute;

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = -positions.getY(i);
      const height = terrainHeight(x, z);
      positions.setZ(i, height);
    }
    positions.needsUpdate = true;
    plane.computeVertexNormals();
    plane.rotateX(-Math.PI / 2);
    return plane;
  }, []);

  const material = useMemo(
    () =>
      new MeshStandardMaterial({
        color: new Color("#464c43"),
        roughness: 0.92,
        metalness: 0.08,
        envMapIntensity: 0.6,
      }),
    [],
  );

  return (
    <mesh ref={meshRef} geometry={geometry} receiveShadow castShadow>
      <primitive object={material} attach="material">
        <GradientTexture
          stops={[0, 0.35, 0.6, 1]}
          colors={["#14171b", "#2a2e27", "#3d4a38", "#7d8767"]}
          size={1024}
        />
      </primitive>
    </mesh>
  );
}

function Structures() {
  const structures = useMemo(() => {
    const nodes: Array<{
      position: [number, number, number];
      size: [number, number, number];
      rotation: [number, number, number];
      color: string;
    }> = [];

    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2 + (Math.sin(i) * 0.35);
      const radius = 36 + (i % 5) * 6 + Math.random() * 4;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const height = 6 + ((i % 4) + Math.random()) * 3;
      const size: [number, number, number] = [4 + Math.random() * 1.8, height, 4 + Math.random() * 1.8];
      const rotation: [number, number, number] = [0, Math.random() * Math.PI * 2, 0];
      const altitude = terrainHeight(x, z) + height / 2;
      nodes.push({
        position: [x, altitude, z],
        size,
        rotation,
        color: i % 3 === 0 ? "#232936" : "#1b222c",
      });
    }
    return nodes;
  }, []);

  return (
    <group>
      {structures.map((structure, index) => (
        <mesh
          key={`structure-${index}`}
          position={structure.position}
          rotation={structure.rotation}
          castShadow
          receiveShadow
        >
          <boxGeometry args={structure.size} />
          <meshStandardMaterial color={structure.color} roughness={0.7} metalness={0.2} />
        </mesh>
      ))}
      <LandingPad />
    </group>
  );
}

function LandingPad() {
  const padRadius = 12;
  const padPosition: [number, number, number] = [8, terrainHeight(8, -12) + 0.2, -12];

  return (
    <group position={padPosition}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <cylinderGeometry args={[padRadius, padRadius, 0.4, 64]} />
        <meshStandardMaterial color="#232932" roughness={0.4} metalness={0.45} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.12, 0]}>
        <cylinderGeometry args={[padRadius * 0.82, padRadius * 0.82, 0.1, 64]} />
        <meshStandardMaterial color="#1b1f27" roughness={0.35} metalness={0.5} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.16, 0]}>
        <ringGeometry args={[padRadius * 0.68, padRadius * 0.72, 64]} />
        <meshStandardMaterial emissive="#3fe7ff" emissiveIntensity={3.5} color="#072a33" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.18, 0]}>
        <ringGeometry args={[padRadius * 0.5, padRadius * 0.54, 64]} />
        <meshStandardMaterial emissive="#71ffb3" emissiveIntensity={2.4} color="#0f2418" />
      </mesh>
    </group>
  );
}

function GlowingRidge() {
  const points = useMemo(() => {
    const nodes: Array<[number, number, number]> = [];
    for (let i = 0; i < 42; i++) {
      const angle = (i / 42) * Math.PI * 2;
      const radius = 60 + Math.sin(i * 0.6) * 12;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = terrainHeight(x, z) + 0.4;
      nodes.push([x, y, z]);
    }
    return nodes;
  }, []);

  return (
    <group>
      {points.map(([x, y, z], idx) => (
        <mesh key={`ridge-${idx}`} position={[x, y, z]}>
          <sphereGeometry args={[0.65 + Math.sin(idx) * 0.12, 12, 12]} />
          <meshStandardMaterial
            emissive={idx % 2 === 0 ? "#36f0ff" : "#7bffcf"}
            emissiveIntensity={idx % 2 === 0 ? 1.9 : 1.2}
            color="#0a1115"
            roughness={0.3}
            metalness={0.2}
          />
        </mesh>
      ))}
    </group>
  );
}

function Atmospherics() {
  return (
    <>
      <Sky distance={450000} sunPosition={[120, 35, -20]} inclination={0.52} azimuth={0.19} mieCoefficient={0.001} />
      <Stars radius={260} depth={60} count={4200} factor={2.8} saturation={0.1} fade speed={0.25} />
      <Cloud
        position={[0, 42, -30]}
        scale={[100, 20, 60]}
        segments={24}
        bounds={[200, 30, 120]}
        opacity={0.35}
        speed={0.08}
      />
      <Sparkles
        count={160}
        speed={0.4}
        opacity={0.2}
        scale={[ARENA_HALF_SIZE * 2, 12, ARENA_HALF_SIZE * 2]}
        size={2.4}
        color="#3de0ff"
      />
    </>
  );
}

function PostFX() {
  return (
    <EffectComposer multisampling={0}>
      <SMAA />
      <Bloom
        luminanceThreshold={0.25}
        luminanceSmoothing={0.1}
        intensity={0.75}
        mipmapBlur
        radius={0.6}
      />
      <DepthOfField focusDistance={0.02} focalLength={0.045} bokehScale={3.5} />
      <ChromaticAberration offset={[0.0018, 0.001]} blendFunction={BlendFunction.NORMAL} />
      <Noise premultiply opacity={0.035} />
      <Vignette eskil={false} offset={0.48} darkness={0.9} />
    </EffectComposer>
  );
}

function Preloader() {
  return (
    <Html center>
      <div className="rounded-full border border-slate-700/60 bg-slate-900/80 px-6 py-3 text-sm uppercase tracking-[0.3em] text-slate-200 shadow-xl shadow-slate-900/80">
        Initializing Simulation
      </div>
    </Html>
  );
}

function HUD({ controlsRef }: { controlsRef: RefObject<PointerLockControlsImpl | null> }) {
  const { speed, altitude, stamina, locked } = usePlayerState((state) => ({
    speed: state.speed,
    altitude: state.altitude,
    stamina: state.stamina,
    locked: state.locked,
  }));

  return (
    <>
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2">
        <div className="absolute left-1/2 top-0 h-5 w-px -translate-x-1/2 bg-white/85" />
        <div className="absolute bottom-0 left-1/2 h-5 w-px -translate-x-1/2 bg-white/85" />
        <div className="absolute left-0 top-1/2 h-px w-5 -translate-y-1/2 bg-white/85" />
        <div className="absolute right-0 top-1/2 h-px w-5 -translate-y-1/2 bg-white/85" />
      </div>

      <div className="pointer-events-none absolute left-8 top-8 flex flex-col gap-3 text-sm text-zinc-100">
        <div className="rounded-lg border border-white/10 bg-black/60 px-4 py-3 shadow-lg shadow-black/30 backdrop-blur">
          <p className="text-xs uppercase tracking-[0.35em] text-emerald-300/80">Vitals</p>
          <p className="mt-2 text-lg font-semibold text-white">{speed.toFixed(1)} m/s</p>
          <p className="text-xs uppercase tracking-wider text-zinc-400">Ground speed</p>
          <p className="mt-3 text-lg font-semibold text-white">{altitude.toFixed(1)} m</p>
          <p className="text-xs uppercase tracking-wider text-zinc-400">Altitude</p>
          <div className="mt-4 h-2 w-48 rounded-full bg-black/60">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-cyan-300 to-sky-400 transition-[width] duration-200"
              style={{ width: `${Math.max(0, Math.min(stamina, 100))}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] uppercase tracking-[0.4em] text-zinc-500">Stamina</p>
        </div>

        <div className="rounded border border-white/10 bg-black/55 px-4 py-3 text-xs leading-relaxed tracking-wide text-zinc-300 backdrop-blur">
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-white/80">Controls</p>
          <p>WASD / Arrows — Move</p>
          <p>Shift — Sprint · Space — Jump</p>
          <p>Ctrl / C — Crouch</p>
          <p>Click — Lock View</p>
        </div>
      </div>

      {!locked && (
        <div className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center gap-6 bg-slate-950/95 text-center text-zinc-100 backdrop-blur">
          <h1 className="text-3xl font-semibold tracking-tight text-white">Aurora Outpost Simulation</h1>
          <p className="max-w-md text-sm text-zinc-300">
            Engage your neural visor to enter the outpost perimeter. Navigate the terrain, scout the luminous ridge, and
            stay agile while your systems warm up.
          </p>
          <button
            className="rounded-full bg-gradient-to-r from-emerald-400 to-sky-400 px-6 py-3 text-sm font-semibold uppercase tracking-[0.3em] text-emerald-950 transition hover:from-emerald-300 hover:to-sky-300"
            onClick={() => controlsRef.current?.lock()}
          >
            Enter Simulation
          </button>
        </div>
      )}
    </>
  );
}

export default FPSScene;
