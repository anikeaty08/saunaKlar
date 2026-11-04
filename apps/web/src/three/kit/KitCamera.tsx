import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { interiorView } from './interior.ts';
import type { KitSpec } from './spec.ts';

export type CameraView = 'exterior' | 'interior';

interface Props {
  spec: Pick<KitSpec, 'form' | 'width' | 'depth' | 'height'> & Partial<KitSpec>;
  view: CameraView;
  /** Increment to put the camera back to its starting place. */
  resetKey?: number;
}

/**
 * Camera for the kit saunas. Outside it orbits the cabin. Inside it is first
 * person: the camera stands just behind the door and dragging turns the head
 * in place around a pivot a few millimetres ahead, so looking around never
 * moves the viewer through a wall; the wheel or a pinch zooms the lens instead.
 */
export function KitCamera({ spec, view, resetKey = 0 }: Props) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree(s => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree(s => s.gl);
  const invalidate = useThree(s => s.invalidate);
  const aspect = useThree(s => s.size.width / Math.max(1, s.size.height));
  const { form, width: W, depth: D, height: H } = spec;
  const radius = Math.max(W, D, H);
  const inside = useMemo(() => interiorView(spec as KitSpec), [form, W, D, H, spec.bench?.layout, spec.bench?.levels]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ctl = controls.current;
    if (!ctl) return;
    // Portrait screens see less sideways: widen the lens or step back.
    const narrow = Math.max(1, 1.15 / aspect);
    if (view === 'interior') {
      const fov = Math.min(92, 2 * Math.atan(Math.tan((70 * Math.PI) / 360) * narrow) * (180 / Math.PI));
      camera.position.set(...inside.eye);
      const dir = new THREE.Vector3(...inside.look).sub(camera.position).normalize();
      ctl.target.copy(camera.position).addScaledVector(dir, 0.01);
      camera.fov = fov;
      ctl.minDistance = ctl.maxDistance = 0.01;
      ctl.enableZoom = false;
      ctl.minPolarAngle = Math.PI * 0.18;
      ctl.maxPolarAngle = Math.PI * 0.82;
      ctl.rotateSpeed = -0.45; // drag the view, not the room
    } else {
      const k = Math.pow(narrow, 0.8);
      camera.position.set(radius * 1.45 * k, H * 0.95 + radius * 0.35, radius * 2.0 * k);
      ctl.target.set(0, H * 0.45, 0);
      camera.fov = 32;
      ctl.minDistance = radius * 1.1;
      ctl.maxDistance = radius * 4;
      ctl.enableZoom = true;
      ctl.minPolarAngle = 0.25;
      ctl.maxPolarAngle = Math.PI / 2 - 0.06;
      ctl.rotateSpeed = 1;
    }
    camera.near = view === 'interior' ? 0.02 : 0.05;
    camera.updateProjectionMatrix();
    ctl.update();
    invalidate();
  }, [view, inside, radius, H, camera, invalidate, resetKey, Math.round(aspect * 4)]); // eslint-disable-line react-hooks/exhaustive-deps

  // Inside, the wheel and pinch zoom the lens rather than walking through walls.
  useEffect(() => {
    if (view !== 'interior') return;
    const el = gl.domElement;
    const zoom = (delta: number) => {
      camera.fov = THREE.MathUtils.clamp(camera.fov + delta, 40, 95);
      camera.updateProjectionMatrix();
      invalidate();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom(Math.sign(e.deltaY) * 3);
    };
    let pinch = 0;
    const span = (e: TouchEvent) => Math.hypot(e.touches[0]!.clientX - e.touches[1]!.clientX, e.touches[0]!.clientY - e.touches[1]!.clientY);
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const s = span(e);
      if (pinch) zoom((pinch - s) * 0.12);
      pinch = s;
    };
    const onTouchEnd = () => { pinch = 0; };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [view, gl, camera, invalidate]);

  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} enablePan={false} />;
}
