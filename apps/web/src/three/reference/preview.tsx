/** Dev-only reference-model visual check, separate from the storefront route. */
import { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { ReferenceSauna } from './ReferenceSauna.tsx';
import { KitEffects, KitLights, setupKitRenderer } from '../kit/KitStage.tsx';
import { DEFAULT_VIEWER_OPTIONS, type ViewerOptions } from '../types.ts';

const params = new URLSearchParams(location.search);
const widthMm = Number(params.get('w') || 3060);
const depthMm = Number(params.get('d') || 3013);
const heightMm = Number(params.get('h') || 2292);
const view = params.get('view') ?? 'exterior';
const interior = view === 'interior';
const D = depthMm / 1000, H = heightMm / 1000;

/** The photographed finish: knotty pine walls, pale aspen benches (catalogue defaults). */
const options: ViewerOptions = structuredClone(DEFAULT_VIEWER_OPTIONS);
options.wallWood = { color: params.get('wall') ?? '#d3a877', grain: (params.get('grain') as 'knotty' | 'clear' | null) ?? 'knotty' };
options.benchWood = { color: params.get('bench') ?? '#ecdcbe', grain: 'clear' };
options.door = (params.get('door') as ViewerOptions['door'] | null) ?? 'clear';
options.heater = (params.get('heater') as ViewerOptions['heater'] | null) ?? 'electric-large';
options.backrest = params.get('backrest') === 'none' ? 'none' : 'continuous';
options.lights.backrest = options.lights.underBench = params.get('lights') === '1';

interface View { position: [number, number, number]; target: [number, number, number]; fov?: number; up?: [number, number, number] }
/**
 * `iso`, `front` and `plan` are orthographic and match tools/blender/render_skp_reference.py
 * (--view iso|front|plan, 5.2 m across 1200 px) for side-by-side checks against the SKP.
 * Browser frame from the SKP frame: x = y_s, y = z_s + H0/2, z = x_s + 0.356.
 */
const ORTHO_ZOOM = 1200 / 5.2;
const cameras: Record<string, View> = {
  iso: { position: [-4.6, 3 + 1.146, 4.5 + 0.356], target: [0, 1.146, 0.356] },
  front: { position: [0, 1.146, 8.356], target: [0, 1.146, 0.356] },
  plan: { position: [0, 9.146, 0], target: [0, 0, 0], up: [0, 0, -1] },
  // Perspective views: front-left above, the catalogue hero and standing inside by the heater.
  exterior: { position: [-3.6, 2.9, 4.4], target: [0, 1.0, 0], fov: 38 },
  catalogue: { position: [-2.4, 1.85, 4.6], target: [-0.1, 0.95, 0], fov: 40 },
  interior: { position: [-0.15, 1.6, D * 0.43], target: [-0.9, 0.85, -D * 0.4], fov: 80 },
};
const camera = cameras[view] ?? cameras.exterior!;
const ortho = camera.fov === undefined;

function Ready() {
  // The screenshot script waits for this flag; give the effects two frames to settle.
  requestAnimationFrame(() => requestAnimationFrame(() => { (window as unknown as { __ready: boolean }).__ready = true; }));
  return null;
}

createRoot(document.getElementById('root')!).render(
  <Canvas orthographic={ortho} camera={ortho ? { position: camera.position, zoom: ORTHO_ZOOM, near: 0.05, far: 100, up: camera.up ?? [0, 1, 0] } : { position: camera.position, fov: camera.fov!, near: 0.05, far: 100 }} shadows dpr={1} gl={{ preserveDrawingBuffer: true }} onCreated={setupKitRenderer}>
    <color attach="background" args={[interior ? '#d8d4cc' : '#cfcbc2']} />
    <KitLights interior={interior} />
    {interior && <pointLight position={[0.3, H - 0.35, -0.1]} intensity={2.2} distance={6} decay={1.4} color="#ffe2bd" />}
    <Suspense fallback={null}>
      <ReferenceSauna specs={{ form: 'hex', source: 'reference', widthMm, depthMm, heightMm }} options={options} />
      <Ready />
    </Suspense>
    <KitEffects interior={interior} />
    <OrbitControls target={camera.target} />
  </Canvas>,
);
