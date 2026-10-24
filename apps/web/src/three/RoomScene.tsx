import { Suspense, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { ParametricSauna } from './ParametricSauna.tsx';
import { floorTexture, type FloorKind } from './textures.ts';
import type { PlacementValue, ViewerOptions, ViewerSpecs } from './types.ts';

export interface RoomPresetInput {
  widthMm: number;
  depthMm: number;
  heightMm: number;
  floor: FloorKind;
  wallColor: string;
  windowWall?: 'north' | 'east' | 'south' | 'west' | 'none';
}

export interface RoomSceneProps {
  preset: RoomPresetInput;
  specs: ViewerSpecs;
  options: ViewerOptions;
  value: PlacementValue;
  onChange?: (v: PlacementValue) => void;
  readOnly?: boolean;
  label: string;
}

/** Half extents of the rotated footprint, for keeping the sauna inside the room. */
function halfExtents(specs: ViewerSpecs, deg: number) {
  const r = (deg * Math.PI) / 180;
  const w = specs.widthMm / 2;
  const d = specs.depthMm / 2;
  return { hx: Math.abs(Math.cos(r)) * w + Math.abs(Math.sin(r)) * d, hz: Math.abs(Math.sin(r)) * w + Math.abs(Math.cos(r)) * d };
}

export function clampPlacement(v: PlacementValue, preset: RoomPresetInput, specs: ViewerSpecs): PlacementValue {
  const rot = ((Math.round(v.rotationDeg) % 360) + 360) % 360;
  const { hx, hz } = halfExtents(specs, rot);
  const mx = Math.max(0, preset.widthMm / 2 - hx);
  const mz = Math.max(0, preset.depthMm / 2 - hz);
  return {
    positionXMm: Math.round(Math.min(mx, Math.max(-mx, v.positionXMm))),
    positionZMm: Math.round(Math.min(mz, Math.max(-mz, v.positionZMm))),
    rotationDeg: rot > 180 ? rot - 360 : rot,
  };
}

function Room({ preset }: { preset: RoomPresetInput }) {
  const W = preset.widthMm / 1000;
  const D = preset.depthMm / 1000;
  const H = preset.heightMm / 1000;
  const outdoor = preset.floor === 'decking' || preset.floor === 'stone';
  const tex = useMemo(() => {
    const t = floorTexture(preset.floor).clone();
    t.needsUpdate = true;
    t.repeat.set(W / 1.6, D / 1.6);
    return t;
  }, [preset.floor, W, D]);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial map={tex} roughness={0.85} />
      </mesh>
      {!outdoor && (
        <>
          {/* Cut-away room: back and left walls only, so the camera sees in. */}
          <mesh position={[0, H / 2, -D / 2]} receiveShadow>
            <planeGeometry args={[W, H]} />
            <meshStandardMaterial color={preset.wallColor} roughness={0.95} />
          </mesh>
          <mesh position={[-W / 2, H / 2, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
            <planeGeometry args={[D, H]} />
            <meshStandardMaterial color={preset.wallColor} roughness={0.95} />
          </mesh>
          {preset.windowWall && preset.windowWall !== 'none' && (
            <mesh position={[-W / 2 + 0.01, H * 0.55, -D * 0.1]} rotation={[0, Math.PI / 2, 0]}>
              <planeGeometry args={[Math.min(1.6, D * 0.4), H * 0.45]} />
              <meshStandardMaterial color="#eef3f4" emissive="#ffffff" emissiveIntensity={0.35} />
            </mesh>
          )}
          {/* skirting */}
          <mesh position={[0, 0.04, -D / 2 + 0.006]}>
            <boxGeometry args={[W, 0.08, 0.012]} />
            <meshStandardMaterial color={new THREE.Color(preset.wallColor).multiplyScalar(0.85)} />
          </mesh>
        </>
      )}
      {/* floor outline */}
      <lineSegments position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <edgesGeometry args={[new THREE.PlaneGeometry(W, D)]} />
        <lineBasicMaterial color="#1c1c1a" transparent opacity={0.35} />
      </lineSegments>
    </group>
  );
}

function Draggable({ preset, specs, options, value, onChange, readOnly }: Omit<RoomSceneProps, 'label'>) {
  const [dragging, setDragging] = useState(false);
  const controls = useThree(s => s.controls) as unknown as { enabled: boolean } | null;
  const offset = useRef({ x: 0, z: 0 });

  const start = (e: ThreeEvent<PointerEvent>) => {
    if (readOnly) return;
    e.stopPropagation();
    (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
    offset.current = { x: e.point.x * 1000 - value.positionXMm, z: e.point.z * 1000 - value.positionZMm };
    setDragging(true);
    if (controls) controls.enabled = false;
    document.body.style.cursor = 'grabbing';
  };
  const end = () => {
    if (!dragging) return;
    setDragging(false);
    if (controls) controls.enabled = true;
    document.body.style.cursor = '';
  };
  const move = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging) return;
    onChange?.(clampPlacement({ ...value, positionXMm: e.point.x * 1000 - offset.current.x, positionZMm: e.point.z * 1000 - offset.current.z }, preset, specs));
  };

  return (
    <>
      {/* Invisible drag plane over the whole floor. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} onPointerMove={move} onPointerUp={end} onPointerLeave={end} visible={false}>
        <planeGeometry args={[100, 100]} />
        <meshBasicMaterial />
      </mesh>
      <group
        position={[value.positionXMm / 1000, 0, value.positionZMm / 1000]}
        rotation={[0, (-value.rotationDeg * Math.PI) / 180, 0]}
        onPointerDown={start}
        onPointerUp={end}
        onPointerOver={() => !readOnly && (document.body.style.cursor = 'grab')}
        onPointerOut={() => !dragging && (document.body.style.cursor = '')}
      >
        <ParametricSauna specs={specs} options={options} />
        {dragging && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
            <planeGeometry args={[specs.widthMm / 1000 + 0.1, specs.depthMm / 1000 + 0.1]} />
            <meshBasicMaterial color="#1c1c1a" transparent opacity={0.12} />
          </mesh>
        )}
      </group>
    </>
  );
}

/**
 * Room planner: a parametric room (floor material, wall colour, size) with
 * the sauna placed on the floor. Drag the sauna to move it; arrow keys move
 * it by 5 cm (Shift: 25 cm); Q/E rotate by 15°. Emits millimetres and degrees.
 */
export default function RoomScene({ preset, specs, options, value, onChange, readOnly, label }: RoomSceneProps) {
  const W = preset.widthMm / 1000;
  const D = preset.depthMm / 1000;
  const span = Math.max(W, D);
  const onKey = (e: KeyboardEvent) => {
    if (readOnly || !onChange) return;
    const step = e.shiftKey ? 250 : 50;
    const next = { ...value };
    if (e.key === 'ArrowLeft') next.positionXMm -= step;
    else if (e.key === 'ArrowRight') next.positionXMm += step;
    else if (e.key === 'ArrowUp') next.positionZMm -= step;
    else if (e.key === 'ArrowDown') next.positionZMm += step;
    else if (e.key === 'q' || e.key === 'Q') next.rotationDeg -= 15;
    else if (e.key === 'e' || e.key === 'E') next.rotationDeg += 15;
    else return;
    e.preventDefault();
    onChange(clampPlacement(next, preset, specs));
  };
  // The room sits on the tenant's paper tone (light or dark), read from the theme tokens.
  const paper = useMemo(() => (typeof document === 'undefined' ? '#f1f0ec' : getComputedStyle(document.documentElement).getPropertyValue('--paper-2').trim() || '#f1f0ec'), []);
  return (
    <div className="room-scene" tabIndex={0} role="application" aria-label={label} onKeyDown={onKey} style={{ position: 'absolute', inset: 0, outlineOffset: -3 }}>
      <Canvas
        frameloop="demand"
        dpr={[1, 1.75]}
        shadows
        camera={{ position: [span * 0.75, span * 0.85, span * 1.05], fov: 35, near: 0.05, far: 200 }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
        }}
      >
        <color attach="background" args={[paper]} />
        <hemisphereLight args={['#ffffff', '#c9c3b8', 0.7]} />
        <directionalLight position={[span, span * 1.6, span * 0.8]} intensity={1.5} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-span} shadow-camera-right={span} shadow-camera-top={span} shadow-camera-bottom={-span} />
        <Suspense fallback={null}>
          <Room preset={preset} />
          <Draggable preset={preset} specs={specs} options={options} value={value} onChange={onChange} readOnly={readOnly} />
        </Suspense>
        <ContactShadows position={[0, 0.003, 0]} opacity={0.35} scale={span * 1.5} blur={2} far={3} />
        <OrbitControls makeDefault enableDamping target={[0, 0.6, 0]} maxPolarAngle={Math.PI / 2 - 0.08} minDistance={span * 0.5} maxDistance={span * 2.4} enablePan={false} />
      </Canvas>
    </div>
  );
}
