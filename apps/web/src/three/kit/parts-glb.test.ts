import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

// Guards the compressed kit-parts.glb: its parts must stay at their authored size
// (heater ~0.4 x 0.8 m), not be scaled/offset by the quantization node transform.
describe('kit-parts.glb', () => {
  it('keeps every part inside a plausible fixture envelope', async () => {
    const io = new NodeIO()
      .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const doc = await io.readBinary(new Uint8Array(readFileSync(new URL('./assets/kit-parts.glb', import.meta.url))));
    const nodes = doc.getRoot().listScenes()[0]!.listChildren();
    expect(nodes.length).toBeGreaterThan(5);
    for (const n of nodes) {
      const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      n.traverse(o => {
        const m = o.getMesh();
        if (!m) return;
        const w = o.getWorldMatrix();
        for (const pr of m.listPrimitives()) {
          const a = pr.getAttribute('POSITION')!, v = [0, 0, 0];
          for (let i = 0; i < a.getCount(); i++) {
            a.getElement(i, v);
            for (let k = 0; k < 3; k++) {
              const c = w[k]! * v[0]! + w[4 + k]! * v[1]! + w[8 + k]! * v[2]! + w[12 + k]!;
              lo[k] = Math.min(lo[k]!, c); hi[k] = Math.max(hi[k]!, c);
            }
          }
        }
      });
      expect(hi[0]! - lo[0]!, n.getName()).toBeLessThan(0.7);
      expect(hi[1]! - lo[1]!, n.getName()).toBeLessThan(1.1);
      expect(hi[2]! - lo[2]!, n.getName()).toBeLessThan(0.7);
      expect(lo[1]!, n.getName()).toBeGreaterThan(-0.01);
      expect(Math.abs(lo[0]! + hi[0]!) / 2, n.getName()).toBeLessThan(0.15);
    }
  });
});
