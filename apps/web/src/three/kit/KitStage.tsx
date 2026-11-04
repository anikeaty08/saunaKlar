import { Environment, Lightformer } from '@react-three/drei';
import { Bloom, EffectComposer, N8AO, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

/** Renderer settings for kit saunas: neutral tone mapping keeps pale woods pale, as in the photos. */
export function setupKitRenderer({ gl }: { gl: THREE.WebGLRenderer }) {
  gl.toneMapping = THREE.NeutralToneMapping;
  gl.toneMappingExposure = 1.0;
}

/**
 * Studio light for a sauna on show: a soft key with shadows, a cool fill and a
 * procedural soft-box environment for reflections in glass and steel. Nothing
 * is downloaded.
 */
export function KitLights({ interior = false }: { interior?: boolean }) {
  // Inside, daylight only comes through the glass: the room is lit mostly by its
  // own warm lamps and LED strips, so the shared sky light is turned well down.
  const scene = useThree(s => s.scene);
  const invalidate = useThree(s => s.invalidate);
  useEffect(() => {
    scene.environmentIntensity = interior ? 0.45 : 1;
    invalidate();
  }, [scene, interior, invalidate]);
  return (
    <>
      <hemisphereLight args={['#ffffff', '#cfc8bd', interior ? 0.42 : 0.75]} />
      {interior && <Backdrop />}
      <directionalLight position={[3.5, 6, 4]} intensity={interior ? 0.9 : 1.35} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0003} shadow-normalBias={0.02}
        shadow-camera-left={-4} shadow-camera-right={4} shadow-camera-top={4} shadow-camera-bottom={-4} />
      <directionalLight position={[-4, 3, -2]} intensity={0.4} color="#eef3ff" />
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.4} position={[0, 5, 0]} rotation-x={Math.PI / 2} scale={[8, 8, 1]} />
        <Lightformer form="rect" intensity={1.3} position={[-5, 2, 1]} rotation-y={Math.PI / 2} scale={[6, 3, 1]} />
        <Lightformer form="rect" intensity={0.9} position={[5, 2, -1]} rotation-y={-Math.PI / 2} scale={[6, 3, 1]} />
        <Lightformer form="rect" intensity={0.7} position={[0, 2, 6]} scale={[6, 2, 1]} />
      </Environment>
    </>
  );
}

/**
 * Screen-space ambient occlusion (N8AO): corners, the gaps under benches and
 * the space round the heater darken softly, the way bounced light does in the
 * photos, instead of every surface being lit evenly. A gentle bloom lets the
 * LED strips glow. Phones get the half-resolution pass.
 */
export function KitEffects({ interior }: { interior: boolean }) {
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  return (
    <EffectComposer multisampling={coarse ? 0 : 4} enableNormalPass={false}>
      <N8AO aoRadius={interior ? 0.8 : 0.6} distanceFalloff={interior ? 0.8 : 1} intensity={interior ? 3.2 : 2.2} aoSamples={coarse ? 8 : 16} denoiseSamples={coarse ? 4 : 8} halfRes={coarse} color="#3a2a1c" />
      {interior ? <Bloom mipmapBlur intensity={0.3} luminanceThreshold={0.95} luminanceSmoothing={0.08} /> : <></>}
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
    </EffectComposer>
  );
}

/** What the glass looks out on from inside: a soft sky over a green-grey garden, not a white void. */
function Backdrop() {
  const geo = useMemo(() => {
    const g = new THREE.SphereGeometry(40, 48, 24);
    const pos = g.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    const sky = new THREE.Color('#c9d6e2'), haze = new THREE.Color('#eef0ec'), ground = new THREE.Color('#7f8670'), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 40;
      if (y >= 0) c.copy(haze).lerp(sky, Math.min(1, Math.pow(y, 0.6)));
      else c.copy(haze).lerp(ground, Math.min(1, -y * 6));
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }, []);
  return (
    <mesh geometry={geo} renderOrder={-1}>
      <meshBasicMaterial vertexColors side={THREE.BackSide} depthWrite={false} fog={false} />
    </mesh>
  );
}
