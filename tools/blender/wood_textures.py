"""
Wood textures for the kit saunas, painted to match the owner's photos and saved
through Blender (run with Blender's Python, the `bpy` module):

    python tools/blender/wood_textures.py

Writes to apps/web/src/three/kit/assets/:
  wall-knotty.jpg / wall-knotty-n.png   stone pine (Zirbe) wall boards with knots
  wall-clear.jpg  / wall-clear-n.png    clear-grain boards (aspen, alder, cedar)
  slat.jpg                              aspen bench slat
  wood.json                             mean linear colour of each map, for tinting

Every map tiles in both directions (all noise is made periodic with an FFT), and
covers the real size the kit expects: boards 2.4 x 1.2 m, slat 1.2 x 0.12 m.
"""

import json
import math
import os

import bpy
import numpy as np

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'apps', 'web', 'src', 'three', 'kit', 'assets')


def srgb(hexstr):
    h = hexstr.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float32)


def to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def periodic_noise(rng, h, w, sx, sy):
    """Tileable smooth noise in [-1, 1]; sx, sy are feature sizes in pixels."""
    n = rng.standard_normal((h, w)).astype(np.float32)
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    filt = np.exp(-((fx * sx) ** 2 + (fy * sy) ** 2) * 2.0)
    out = np.real(np.fft.ifft2(np.fft.fft2(n) * filt)).astype(np.float32)
    out -= out.mean()
    return out / (np.abs(out).max() + 1e-6)


def save(name, rgb, fmt):
    """Writes an (h, w, 3) float image in [0, 1] (top row first) through Blender."""
    h, w, _ = rgb.shape
    img = bpy.data.images.new(name, width=w, height=h, alpha=False, float_buffer=False)
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(rgba[::-1].ravel())  # Blender stores the bottom row first
    path = os.path.abspath(os.path.join(OUT, name))
    img.filepath_raw = path
    img.file_format = fmt
    if fmt == 'JPEG':
        bpy.context.scene.render.image_settings.quality = 88
    img.save(filepath=path, quality=88) if fmt == 'JPEG' else img.save(filepath=path)
    bpy.data.images.remove(img)
    print('wrote', path, f'{os.path.getsize(path) // 1024} KB')


def normal_from_height(hgt, strength):
    dx = (np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)) * 0.5
    dy = (np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)) * 0.5
    nx, ny, nz = -dx * strength, dy * strength, np.ones_like(hgt)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / ln, ny / ln, nz / ln], -1) * 0.5 + 0.5


class Look:
    def __init__(self, base, late, ring, core, knots_per_m2, ring_mm, contrast, tone_var, heart):
        self.base, self.late, self.ring, self.core = srgb(base), srgb(late), srgb(ring), srgb(core)
        self.knots_per_m2, self.ring_mm, self.contrast, self.tone_var, self.heart = knots_per_m2, ring_mm, contrast, tone_var, heart


# Stone pine as in the photos: pale cream, soft grain, round knots with dark rims.
KNOTTY = Look('#e6d2ad', '#c8a57a', '#3c2a1d', '#8c6a4f', knots_per_m2=22, ring_mm=7.0, contrast=1.0, tone_var=0.045, heart=0.35)
# Clear grade (aspen and similar): finer, quieter grain, the odd pin knot.
CLEAR = Look('#ebdfc6', '#d6c19c', '#7a5a3e', '#b89068', knots_per_m2=0.8, ring_mm=4.5, contrast=0.55, tone_var=0.03, heart=0.0)


def paint(look, W, H, size_m, boards, seed, grooves=True):
    """Paints a sheet of boards running along x. Returns (rgb, height)."""
    rng = np.random.default_rng(seed)
    ppm = W / size_m[0]
    rgb = np.zeros((H, W, 3), dtype=np.float32)
    hgt = np.zeros((H, W), dtype=np.float32)
    xs = np.arange(W, dtype=np.float32)

    # A few tileable noise fields shared by all boards (each board reads them at its own offset).
    flow = [periodic_noise(rng, H, W, ppm * 0.35, ppm * 0.08) for _ in range(3)]  # slow sway of the rings
    fibre = [periodic_noise(rng, H, W, ppm * 0.02, ppm * 0.0012) for _ in range(2)]  # long thin fibres
    cloud = [periodic_noise(rng, H, W, ppm * 0.25, ppm * 0.05) for _ in range(2)]  # tone patches
    bh = H / boards

    for b in range(boards):
        y0, y1 = int(round(b * bh)), int(round((b + 1) * bh))
        rows = slice(y0, y1)
        ys = (np.arange(y0, y1, dtype=np.float32) - y0)[:, None]  # px from the board's top edge
        # Butt joints: one at a random place, so each board is two lengths and the sheet still tiles.
        cut = int(rng.uniform(0.2, 0.85) * W) if rng.random() < 0.8 else None
        pieces = [(0, W)] if cut is None else [(0, cut), (cut, W)]
        # A piece that wraps over the right edge continues the one on the left edge.
        for pi, (x0, x1) in enumerate(pieces):
            cols = slice(x0, x1)
            k = rng.integers(3)
            shift = int(rng.integers(W))
            f = np.roll(flow[k], shift, 1)[rows, cols]
            fb = np.roll(fibre[pi % 2], shift, 1)[rows, cols]
            cl = np.roll(cloud[pi % 2], shift, 1)[rows, cols]
            X = xs[None, cols]
            # Growth rings: mostly straight along the board, swaying, with the odd arch.
            ring = look.ring_mm / 1000 * ppm * rng.uniform(0.75, 1.3)
            phase = (ys + rng.uniform(0, 400)) / ring + f * rng.uniform(2.5, 5.0)
            if rng.random() < 0.45:  # a flat-sawn cathedral arch
                cx = rng.uniform(x0, x1)
                span = rng.uniform(0.35, 0.9) * ppm
                phase += (((X - cx) / span) ** 2) * rng.uniform(1.5, 4.0) * np.sign(rng.uniform(-1, 1))

            # Knots, with the grain bending round them.
            area = (x1 - x0) / ppm * (y1 - y0) / ppm
            n = rng.poisson(look.knots_per_m2 * area)
            knots = []
            for _ in range(n):
                u = rng.random()
                r_mm = rng.uniform(2.5, 4.5) if u < 0.4 else rng.uniform(5, 9) if u < 0.9 else rng.uniform(10, 14)
                kx = rng.uniform(x0 + 6, x1 - 6)
                ky = rng.uniform(-0.1, 1.1) * (y1 - y0)
                knots.append((kx, ky, r_mm / 1000 * ppm, rng.random() < 0.3))
            for kx, ky, r, _ in knots:
                d2 = ((X - kx) * 1.25) ** 2 + (ys - ky) ** 2
                phase += np.exp(-d2 / (2 * (2.6 * r) ** 2)) * (2.2 * r / ring) * np.sign(ys - ky + 1e-3)

            # Soft latewood bands of uneven width, plus a fainter second set so the stripes never look drawn.
            late = np.exp(-((np.mod(phase, 1.0) - 0.5) / (0.2 + 0.08 * f)) ** 2) * (0.55 + 0.45 * np.abs(np.roll(f, 37, 0)))
            late2 = np.exp(-((np.mod(phase * 2.37 + 0.3, 1.0) - 0.5) / 0.25) ** 2) * 0.35
            t = look.contrast * (late * 0.75 + late2 * 0.3 + fb * 0.3)
            col = look.base[None, None, :] * (1 - t[..., None] * 0.38) + look.late[None, None, :] * (t[..., None] * 0.38)
            # Each length of board has its own tone; a few carry a warm heartwood streak.
            tone = 1 + rng.normal(0, look.tone_var) + cl * 0.025
            col *= tone[..., None] if np.ndim(tone) else tone
            if rng.random() < look.heart:
                streak = np.clip((cl + rng.uniform(-0.2, 0.3)) * 2.2, 0, 1) * rng.uniform(0.2, 0.4)
                warm = np.array([1.0, 0.91, 0.82], dtype=np.float32)
                col = col * (1 - streak[..., None]) + col * warm * streak[..., None]
            h = fb * 0.15 + late * 0.1

            for kx, ky, r, dead in knots:
                d = np.sqrt(((X - kx) * 1.15) ** 2 + (ys - ky) ** 2)
                rim = max(2.2, 0.22 * r)
                inner = np.clip((r - d) / 1.5, 0, 1)  # inside the knot
                rimw = np.exp(-((d - r) / rim) ** 2)  # the dark bark ring
                halo = np.exp(-((d - r * 1.7) / (r * 0.9)) ** 2) * 0.12
                # Inside: concentric rings of the branch, darker towards the pith.
                inside_rings = 0.5 + 0.5 * np.cos(d / max(r, 1) * math.pi * 3.5)
                core = look.core * (0.82 + 0.18 * inside_rings[..., None])
                if dead:
                    core = core * 0.62
                pith = np.exp(-(d / max(1.0, r * 0.18)) ** 2) * 0.5
                col = col * (1 - halo[..., None]) + col * np.array([0.86, 0.75, 0.62]) * halo[..., None]
                col = col * (1 - inner[..., None]) + core * (1 - pith[..., None]) * inner[..., None] + look.ring * pith[..., None] * inner[..., None]
                col = col * (1 - rimw[..., None] * 0.85) + look.ring * rimw[..., None] * 0.85
                h += inner * 0.25 - rimw * 0.2

            rgb[rows, cols] = col
            hgt[rows, cols] = h
            if x0 > 0:  # butt joint
                rgb[rows, x0 - 1:x0 + 1] *= 0.55
                hgt[rows, x0 - 1:x0 + 1] -= 1.2

        if grooves:
            # Tongue-and-groove joint: a dark V with a lit lip below it.
            for dy, k, dh in ((-2, 0.86, -0.5), (-1, 0.62, -1.4), (0, 0.42, -2.0), (1, 0.6, -1.4), (2, 0.82, -0.6), (3, 1.04, 0.1)):
                yy = (y0 + dy) % H
                rgb[yy] *= k
                hgt[yy] += dh
    return rgb, hgt


def main():
    os.makedirs(OUT, exist_ok=True)
    means = {}
    for name, look, seed in (('wall-knotty', KNOTTY, 11), ('wall-clear', CLEAR, 23)):
        rgb, hgt = paint(look, 2048, 1024, (2.4, 1.2), boards=8, seed=seed)
        save(f'{name}.jpg', rgb, 'JPEG')
        save(f'{name}-n.png', normal_from_height(hgt, 1.6), 'PNG')
        means[name] = [round(float(v), 4) for v in to_linear(rgb).reshape(-1, 3).mean(0)]
    rgb, _ = paint(CLEAR, 1024, 128, (1.2, 0.12), boards=1, seed=5, grooves=False)
    save('slat.jpg', rgb, 'JPEG')
    means['slat'] = [round(float(v), 4) for v in to_linear(rgb).reshape(-1, 3).mean(0)]
    with open(os.path.join(OUT, 'wood.json'), 'w') as f:
        json.dump(means, f, indent=2)
    print(means)


main()
