import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, OrbitControls, useGLTF, useProgress } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { ParametricSauna } from './ParametricSauna.tsx';
import { DRACO_PATH, useProgressiveModel } from './useProgressiveModel.ts';
import type { ViewerOptions, ViewerSpecs } from './types.ts';

export interface SaunaViewerProps {
  specs: ViewerSpecs;
  options: ViewerOptions;
  lowUrl?: string | null;
  highUrl?: string | null;
  /** Logged-in customer or share-link viewer: high LOD may stream. */
  allowHigh?: boolean;
  label: string;
  onProgress?: (percent: number, active: boolean) => void;
  /** Increment to reset the camera. */
  resetKey?: number;
  background?: string;
}

function Glb({ url }: { url: string }) {
  const gltf = useGLTF(url, DRACO_PATH, true);
  const scene = useMemo(() => gltf.scene.clone(true), [gltf]);
  useEffect(() => {
    scene.traverse(o => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return () => {
      scene.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach(mat => mat.dispose());
        }
      });
    };
  }, [scene]);
  return <primitive object={scene} />;
}

/** Low model as the Suspense fallback of the high one: no blank frame during the swap. */
function ProgressiveGlb({ lowUrl, highUrl }: { lowUrl: string; highUrl: string | null }) {
  const low = <Glb url={lowUrl} />;
  if (!highUrl) return low;
  return (
    <Suspense fallback={low}>
      <Glb url={highUrl} />
    </Suspense>
  );
}

function ProgressReporter({ onProgress }: { onProgress?: ((p: number, active: boolean) => void) | undefined }) {
  const { progress, active } = useProgress();
  useEffect(() => onProgress?.(Math.round(progress), active), [progress, active, onProgress]);
  return null;
}

function CameraRig({ resetKey, radius }: { resetKey: number; radius: number }) {
  const controls = useThree(s => s.controls) as OrbitControlsImpl | null;
  const invalidate = useThree(s => s.invalidate);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    controls?.reset();
    invalidate();
  }, [resetKey, controls, invalidate]);
  useEffect(() => {
    if (!controls) return;
    controls.minDistance = radius * 1.1;
    controls.maxDistance = radius * 4;
  }, [controls, radius]);
  return null;
}

export default function SaunaViewer({ specs, options, lowUrl = null, highUrl = null, allowHigh = false, label, onProgress, resetKey = 0, background }: SaunaViewerProps) {
  const model = useProgressiveModel(lowUrl, highUrl, allowHigh);
  const w = specs.widthMm / 1000;
  const d = specs.depthMm / 1000;
  const h = specs.heightMm / 1000;
  const radius = Math.max(w, d, h);
  const camPos: [number, number, number] = [radius * 1.45, h * 0.95 + radius * 0.35, radius * 2.0];

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.75]}
      shadows
      camera={{ position: camPos, fov: 32, near: 0.05, far: 100 }}
      gl={{ antialias: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
      aria-label={label}
      role="img"
    >
      {background && <color attach="background" args={[background]} />}
      <ProgressReporter onProgress={onProgress} />
      <hemisphereLight args={['#ffffff', '#b8b2a8', 0.55]} />
      <directionalLight position={[3.5, 6, 4]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} shadow-bias={-0.0004} shadow-camera-left={-4} shadow-camera-right={4} shadow-camera-top={4} shadow-camera-bottom={-4} />
      <directionalLight position={[-4, 3, -2]} intensity={0.35} />
      {/* Procedural studio environment: soft boxes, no HDR download. */}
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.2} position={[0, 5, 0]} rotation-x={Math.PI / 2} scale={[8, 8, 1]} />
        <Lightformer form="rect" intensity={1.2} position={[-5, 2, 1]} rotation-y={Math.PI / 2} scale={[6, 3, 1]} />
        <Lightformer form="rect" intensity={0.8} position={[5, 2, -1]} rotation-y={-Math.PI / 2} scale={[6, 3, 1]} />
        <Lightformer form="ring" intensity={0.6} position={[0, 2, 6]} scale={3} />
      </Environment>
      <Suspense fallback={null}>
        <group>{model.lowUrl ? <ProgressiveGlb lowUrl={model.lowUrl} highUrl={model.highUrl} /> : <ParametricSauna specs={specs} options={options} />}</group>
      </Suspense>
      <ContactShadows position={[0, 0.001, 0]} opacity={0.42} scale={radius * 3.5} blur={2.4} far={h * 1.2} resolution={512} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} target={[0, h * 0.45, 0]} minPolarAngle={0.25} maxPolarAngle={Math.PI / 2 - 0.06} enablePan={false} />
      <CameraRig resetKey={resetKey} radius={radius} />
    </Canvas>
  );
}
