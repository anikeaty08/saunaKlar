import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { ContactShadows, OrbitControls, useGLTF, useProgress } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { KitSauna } from './kit/KitSauna.tsx';
import { ReferenceSauna } from './reference/ReferenceSauna.tsx';
import { KitCamera, type CameraView } from './kit/KitCamera.tsx';
import { KitEffects, KitLights, setupKitRenderer } from './kit/KitStage.tsx';
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
  /** Kit models: the sauna has loaded and is on screen. */
  onReady?: () => void;
  /** Increment to reset the camera. */
  resetKey?: number;
  background?: string;
  /** Outside orbit, or standing inside (kit models only). */
  view?: CameraView;
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

/**
 * Forwards drei's loader progress. Loaders start (and so update the progress
 * store) while a suspending component renders; subscribing outside React and
 * reporting in a microtask keeps that from re-rendering this component in the
 * middle of another one's render ("Cannot update a component while rendering").
 */
export function ProgressReporter({ onProgress }: { onProgress?: ((p: number, active: boolean) => void) | undefined }) {
  useEffect(() => {
    if (!onProgress) return;
    let live = true;
    const report = ({ progress, active }: { progress: number; active: boolean }) => onProgress(Math.round(progress), active);
    report(useProgress.getState());
    const unsubscribe = useProgress.subscribe(() => queueMicrotask(() => live && report(useProgress.getState())));
    return () => {
      live = false;
      unsubscribe();
    };
  }, [onProgress]);
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

export default function SaunaViewer({ specs, options, lowUrl = null, highUrl = null, allowHigh = false, label, onProgress, onReady, resetKey = 0, background, view = 'exterior' }: SaunaViewerProps) {
  const model = useProgressiveModel(lowUrl, highUrl, allowHigh);
  const w = specs.widthMm / 1000;
  const d = specs.depthMm / 1000;
  const h = specs.heightMm / 1000;
  const radius = Math.max(w, d, h);
  const camPos: [number, number, number] = [radius * 1.45, h * 0.95 + radius * 0.35, radius * 2.0];
  const kit = !(specs.source === 'asset' && model.lowUrl);
  const kitSpec = useMemo(() => ({ ...options, form: specs.form, width: w, depth: d, height: h }), [options, specs.form, w, d, h]);

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.75]}
      shadows
      camera={{ position: camPos, fov: 32, near: 0.05, far: 100 }}
      gl={{ antialias: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' }}
      onCreated={setupKitRenderer}
      aria-label={label}
      role="img"
    >
      {background && <color attach="background" args={[background]} />}
      <ProgressReporter onProgress={onProgress} />
      <KitLights interior={kit && view === 'interior'} />
      <Suspense fallback={null}>
        <group>{specs.source === 'reference' ? <ReferenceSauna specs={specs} options={options} onReady={onReady} /> : !kit && model.lowUrl ? <ProgressiveGlb lowUrl={model.lowUrl} highUrl={model.highUrl} /> : <KitSauna specs={specs} options={options} onReady={onReady} />}</group>
      </Suspense>
      {view === 'exterior' && <ContactShadows position={[0, 0.001, 0]} opacity={0.42} scale={radius * 3.5} blur={2.4} far={h * 1.2} resolution={512} />}
      {kit ? (
        <>
          <KitCamera spec={kitSpec} view={view} reference={specs.source === 'reference'} resetKey={resetKey} />
          <KitEffects interior={view === 'interior'} />
        </>
      ) : (
        <>
          <OrbitControls makeDefault enableDamping dampingFactor={0.08} target={[0, h * 0.45, 0]} minPolarAngle={0.25} maxPolarAngle={Math.PI / 2 - 0.06} enablePan={false} />
          <CameraRig resetKey={resetKey} radius={radius} />
        </>
      )}
    </Canvas>
  );
}
