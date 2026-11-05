import { describe, expect, it } from 'vitest';
import { configuredSpecsOf } from './specs.ts';

describe('configuredSpecsOf', () => {
  it('uses selected, priced size options for the viewer and floor area', () => {
    const sauna = {
      attributes: [
        { code: 'width_mm', value: 3060 },
        { code: 'depth_mm', value: 3013 },
        { code: 'height_mm', value: 2292 },
        { code: 'form', value: 'hex' },
      ],
      groups: [
        { code: 'width', options: [{ id: 'w-small', code: 'width-2400' }, { id: 'w-ref', code: 'width-3060' }] },
        { code: 'size-depth', options: [{ id: 'd-small', code: 'size-depth-2400' }] },
        { code: 'height', options: [{ id: 'h-small', code: 'height-2100' }] },
      ],
    } as Parameters<typeof configuredSpecsOf>[0];

    const selected = configuredSpecsOf(sauna, ['w-small', 'd-small', 'h-small']);
    expect(selected).toMatchObject({ widthMm: 2400, depthMm: 2400, heightMm: 2100, footprintM2: 5.76 });
    expect(configuredSpecsOf(sauna, ['w-ref'])).toMatchObject({ widthMm: 3060, depthMm: 3013, heightMm: 2292 });
  });
});
