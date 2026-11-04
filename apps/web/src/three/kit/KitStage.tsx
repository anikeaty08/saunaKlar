import { Environment, Lightformer } from '@react-three/drei';
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
export function KitLights() {
  return (
    <>
      <hemisphereLight args={['#ffffff', '#cfc8bd', 0.75]} />
      <directionalLight position={[3.5, 6, 4]} intensity={1.35} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0003} shadow-normalBias={0.02}
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
