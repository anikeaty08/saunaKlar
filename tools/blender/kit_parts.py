"""
Detailed fixtures for the kit saunas, modelled in Blender and exported as one GLB:

    python tools/blender/kit_parts.py      (Blender's Python: the `bpy` module)

Writes apps/web/src/three/kit/assets/kit-parts.glb. Each top-level object is one
part; the kit places it with the same local frame the procedural parts use:
x along the wall (or across the heater), y up, z towards the room / the bather,
origin on the floor or the wall surface. Blender is Z-up and the glTF exporter
turns (x, y, z) into (x, z, -y), so here "towards the room" is -Y.

Materials named `kit:<slot>` are swapped at runtime for the sauna's own
material in that slot (so wood follows the chosen finish); others ship as is.
Every edge is bevelled so it catches the light like a real, sanded part.
"""

import math
import os
import random

import bpy  # first: it makes bmesh and mathutils importable
import bmesh  # noqa: E402
from mathutils import Matrix, Vector, noise

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'apps', 'web', 'src', 'three', 'kit', 'assets', 'kit-parts.glb'))

bpy.ops.wm.read_factory_settings(use_empty=True)
MATS = {}


def mat(name, color=(0.5, 0.5, 0.5), metallic=0.0, rough=0.6, emission=None):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = rough
    if emission:
        b.inputs['Emission Color'].default_value = (*emission, 1)
        b.inputs['Emission Strength'].default_value = 1.0
    MATS[name] = m
    return m


def kit(slot):
    return mat(f'kit:{slot}')


STONE = None


def stone_mat():
    """Stones carry their own colour per vertex (grey, brown, near black)."""
    global STONE
    if STONE:
        return STONE
    m = mat('stone', (1, 1, 1), 0, 0.92)
    nt = m.node_tree
    attr = nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Col'
    nt.links.new(attr.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    STONE = m
    return m


CERAMIC = mat('ir-ceramic', (0.30, 0.07, 0.04), 0, 0.55, emission=(0.10, 0.015, 0.008))
GLASS_DARK = mat('stove-glass', (0.05, 0.05, 0.05), 0, 0.05)
NEEDLE = mat('needle', (0.02, 0.02, 0.02), 0, 0.4)
DIAL = mat('dial-face', (0.93, 0.92, 0.88), 0, 0.35)


class Builder:
    """Collects bmesh pieces with materials into one object."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []
        self.cols = self.bm.loops.layers.color.new('Col')

    def _mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def add(self, src: bmesh.types.BMesh, m, matrix=Matrix(), color=None):
        src.transform(matrix)
        mi = self._mi(m)
        vmap = {}
        for v in src.verts:
            vmap[v] = self.bm.verts.new(v.co)
        for f in src.faces:
            nf = self.bm.faces.new([vmap[v] for v in f.verts])
            nf.material_index = mi
            nf.smooth = f.smooth
            for loop in nf.loops:
                loop[self.cols] = (*(color or (1, 1, 1)), 1)
        src.free()

    def done(self):
        me = bpy.data.meshes.new(self.name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        # Smooth shading that keeps the bevels crisp.
        for p in me.polygons:
            p.use_smooth = True
        if hasattr(me, 'set_sharp_from_angle'):
            me.set_sharp_from_angle(angle=math.radians(35))
        return ob


def box(x0, x1, y0, y1, z0, z1, bevel=0.003, segs=2):
    """Blender coordinates: x across, y depth (-y = front), z up."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(x1 - x0, y1 - y0, z1 - z0), verts=bm.verts)
    bmesh.ops.translate(bm, vec=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), verts=bm.verts)
    b = min(bevel, (x1 - x0) * 0.45, (y1 - y0) * 0.45, (z1 - z0) * 0.45)
    if b > 1e-5:
        bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=b, segments=segs, profile=0.5, affect='EDGES')
    for f in bm.faces:
        f.smooth = True
    return bm


def cyl(r, h, z0=0.0, segs=32, r2=None, cap=True, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=h)
    bmesh.ops.translate(bm, vec=(0, 0, z0 + h / 2), verts=bm.verts)
    if bevel > 0 and cap:
        rims = [e for e in bm.edges if len(e.link_faces) == 2 and abs(e.link_faces[0].normal.dot(e.link_faces[1].normal)) < 0.5]
        bmesh.ops.bevel(bm, geom=rims, offset=bevel, segments=2, profile=0.5, affect='EDGES')
    for f in bm.faces:
        f.smooth = True
    return bm


def torus(R, r, z, segs=40, rsegs=8):
    bm = bmesh.new()
    verts = []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        ring = []
        for j in range(rsegs):
            b = 2 * math.pi * j / rsegs
            ring.append(bm.verts.new(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), z + r * math.sin(b))))
        verts.append(ring)
    for i in range(segs):
        for j in range(rsegs):
            f = bm.faces.new([verts[i][j], verts[(i + 1) % segs][j], verts[(i + 1) % segs][(j + 1) % rsegs], verts[i][(j + 1) % rsegs]])
            f.smooth = True
    return bm


def stone(rng, size):
    """One river stone: a jittered, flattened, smoothed blob."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1)
    seed = Vector((rng.random() * 50, rng.random() * 50, rng.random() * 50))
    for v in bm.verts:
        n = noise.noise(v.co * 1.3 + seed)
        v.co *= 1 + 0.22 * n
    sx, sy, sz = size * rng.uniform(0.9, 1.25), size * rng.uniform(0.75, 1.0), size * rng.uniform(0.5, 0.75)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rng.uniform(0, math.pi), 3, 'Z') @ Matrix.Rotation(rng.uniform(-0.5, 0.5), 3, 'X'), verts=bm.verts)
    for f in bm.faces:
        f.smooth = True
    return bm, sz


def stone_heap(b: Builder, rng, w, d, z, heap=0.08, size=(0.026, 0.045), layers=3):
    """Stones stacked in a w x d bay from height z, rising to a gentle heap."""
    greys = [(0.20, 0.20, 0.20), (0.28, 0.27, 0.26), (0.36, 0.34, 0.32), (0.16, 0.15, 0.15), (0.33, 0.29, 0.25), (0.42, 0.41, 0.40)]
    placed = []
    for layer in range(layers):
        n = int(w * d / (size[1] ** 2) * 0.9)
        for _ in range(n):
            x, y = rng.uniform(-w / 2 + 0.02, w / 2 - 0.02), rng.uniform(-d / 2 + 0.02, d / 2 - 0.02)
            s = rng.uniform(*size)
            hump = max(0.0, 1 - (abs(x) / (w / 2)) ** 2 - (abs(y) / (d / 2)) ** 2)
            top = z + layer * s * 1.0 + hump * heap * (layer / max(1, layers - 1))
            if layer == layers - 1 and hump < 0.15 and rng.random() < 0.5:
                continue
            bm, sz = stone(rng, s)
            c = greys[rng.randrange(len(greys))]
            k = rng.uniform(0.85, 1.12)
            b.add(bm, stone_mat(), Matrix.Translation((x, y, top + sz * 0.6)), color=tuple(min(1, ch * k) for ch in c))
            placed.append((x, y))


def electric_heater(name, w, h, d, seed):
    b = Builder(name)
    rng = random.Random(seed)
    black, steel = kit('black'), kit('steel')
    # Body on two feet, with a recessed plinth.
    b.add(box(-w / 2, w / 2, -d / 2, d / 2, 0.08, h - 0.16, bevel=0.012, segs=3), black)
    for sx in (-1, 1):
        b.add(box(sx * (w / 2 - 0.06) - 0.025, sx * (w / 2 - 0.06) + 0.025, -d / 2 + 0.03, d / 2 - 0.03, 0, 0.085, bevel=0.004), black)
    # Ventilation louvres on the front and sides.
    for i in range(7):
        z = 0.14 + i * 0.03
        b.add(box(-w / 2 + 0.05, w / 2 - 0.05, -d / 2 - 0.006, -d / 2 + 0.002, z, z + 0.012, bevel=0.003), steel)
    # Stone basket: a steel frame with vertical bars, stones heaped above the rim.
    top = h - 0.16
    b.add(box(-w / 2 - 0.005, w / 2 + 0.005, -d / 2 - 0.005, d / 2 + 0.005, top, top + 0.012, bevel=0.003), steel)
    b.add(box(-w / 2 - 0.005, w / 2 + 0.005, -d / 2 - 0.005, d / 2 + 0.005, h - 0.012, h, bevel=0.003), steel)
    n = int(w / 0.03)
    for i in range(n + 1):
        x = -w / 2 + i * w / n
        for y in (-d / 2, d / 2):
            b.add(cyl(0.004, h - top, top, segs=8), steel, Matrix.Translation((x, y, 0)))
    n = int(d / 0.03)
    for i in range(n + 1):
        y = -d / 2 + i * d / n
        for x in (-w / 2, w / 2):
            b.add(cyl(0.004, h - top, top, segs=8), steel, Matrix.Translation((x, y, 0)))
    stone_heap(b, rng, w - 0.01, d - 0.01, top + 0.005, heap=0.07, layers=4)
    # Controls on the right of the front face.
    for i, z in enumerate((h - 0.24, h - 0.32)):
        knob = cyl(0.02, 0.022, 0, segs=24, bevel=0.003)
        b.add(knob, steel, Matrix.Translation((w / 2 - 0.07, -d / 2, z)) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
    return b.done()


def storage_heater(seed):
    """Heat-storage tower: a cage of flat steel bars full of stones."""
    b = Builder('heater-storage')
    rng = random.Random(seed)
    black, steel = kit('black'), kit('steel')
    R, H = 0.22, 0.92
    b.add(cyl(R * 0.75, 0.05, 0, segs=40, bevel=0.004), black)
    b.add(cyl(R * 0.98, 0.2, 0.05, segs=48, bevel=0.006), black)
    for z in (0.25, 0.58, H - 0.01):
        b.add(torus(R, 0.008, z, segs=48), steel)
    n = 30
    for i in range(n):
        a = 2 * math.pi * i / n
        bar = box(-0.007, 0.007, -0.002, 0.002, 0.25, H, bevel=0.0015, segs=1)
        b.add(bar, black, Matrix.Translation((R * math.cos(a), R * math.sin(a), 0)) @ Matrix.Rotation(a + math.pi / 2, 4, 'Z'))
    # Stones fill the cage; build a column of layers inside the circle.
    z = 0.26
    while z < H + 0.04:
        for _ in range(16):
            r, a = R * 0.85 * math.sqrt(rng.random()), rng.uniform(0, 2 * math.pi)
            s = rng.uniform(0.03, 0.05)
            bm, sz = stone(rng, s)
            g = rng.choice([(0.2, 0.2, 0.2), (0.3, 0.29, 0.27), (0.38, 0.35, 0.32), (0.16, 0.15, 0.15)])
            b.add(bm, stone_mat(), Matrix.Translation((r * math.cos(a), r * math.sin(a), z + sz)), color=g)
        z += 0.045
    return b.done()


def stove(seed):
    """Wood-burning stove: black body, glass door with a fire, stone bay on top."""
    b = Builder('heater-stove')
    rng = random.Random(seed)
    black, steel, fire = kit('black'), kit('steel'), kit('fire')
    w, d = 0.48, 0.44
    b.add(box(-w / 2, w / 2, -d / 2, d / 2, 0.08, 0.72, bevel=0.015, segs=3), black)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.add(cyl(0.02, 0.08, 0, segs=16), black, Matrix.Translation((sx * (w / 2 - 0.05), sy * (d / 2 - 0.05), 0)))
    # Door: frame, dark glass, fire behind, handle.
    b.add(box(-0.17, 0.17, -d / 2 - 0.02, -d / 2 + 0.002, 0.18, 0.48, bevel=0.006), black)
    b.add(box(-0.13, 0.13, -d / 2 - 0.024, -d / 2 - 0.018, 0.22, 0.44, bevel=0.002), GLASS_DARK)
    b.add(box(-0.12, 0.12, -d / 2 + 0.02, -d / 2 + 0.03, 0.22, 0.4, bevel=0.0), fire)
    b.add(box(0.14, 0.16, -d / 2 - 0.06, -d / 2 - 0.02, 0.3, 0.36, bevel=0.006), steel)
    # Ash drawer and air slider.
    b.add(box(-0.15, 0.15, -d / 2 - 0.012, -d / 2 + 0.002, 0.1, 0.15, bevel=0.004), black)
    b.add(box(-0.04, 0.04, -d / 2 - 0.02, -d / 2 - 0.01, 0.12, 0.13, bevel=0.003), steel)
    # Stone bay with a steel rim.
    b.add(box(-w / 2 - 0.01, w / 2 + 0.01, -d / 2 - 0.01, d / 2 + 0.01, 0.72, 0.75, bevel=0.004), steel)
    stone_heap(b, rng, w - 0.04, d - 0.04, 0.73, heap=0.06, layers=3)
    return b.done()


def ir_panel():
    """Infrared emitter: wooden frame round a lattice of dark red ceramic bars (0.95 m tall)."""
    b = Builder('ir-panel')
    wood, black = kit('benchPanel'), kit('black')
    H, W = 0.95, 0.32
    # Frame stiles and rails, 30 mm deep, standing off the wall (here y is the depth axis).
    b.add(box(-W / 2, -W / 2 + 0.045, -0.03, 0, 0, H, bevel=0.003), wood)
    b.add(box(W / 2 - 0.045, W / 2, -0.03, 0, 0, H, bevel=0.003), wood)
    b.add(box(-W / 2 + 0.045, W / 2 - 0.045, -0.03, 0, 0, 0.05, bevel=0.003), wood)
    b.add(box(-W / 2 + 0.045, W / 2 - 0.045, -0.03, 0, H - 0.05, H, bevel=0.003), wood)
    b.add(box(-W / 2 + 0.045, W / 2 - 0.045, -0.006, 0, 0.05, H - 0.05, bevel=0.0), black)
    # Ceramic lattice: rounded vertical bars crossed by short rungs, as in the photos.
    x0, x1, z0, z1 = -W / 2 + 0.055, W / 2 - 0.055, 0.07, H - 0.07
    cols = 5
    for i in range(cols + 1):
        x = x0 + (x1 - x0) * i / cols
        b.add(box(x - 0.006, x + 0.006, -0.022, -0.008, z0, z1, bevel=0.004), CERAMIC)
    rows = 20
    for j in range(rows + 1):
        z = z0 + (z1 - z0) * j / rows
        for i in range(cols):
            xa = x0 + (x1 - x0) * i / cols + 0.004
            xb = x0 + (x1 - x0) * (i + 1) / cols - 0.004
            b.add(box(xa, xb, -0.02, -0.01, z - 0.005, z + 0.005, bevel=0.004, segs=1), CERAMIC)
    return b.done()


def thermometer():
    """Thermo-hygrometer: two dials in a wooden frame (300 x 180 mm)."""
    b = Builder('thermometer')
    wood, steel = kit('benchPanel'), kit('steel')
    b.add(box(-0.15, 0.15, -0.024, 0, 0, 0.18, bevel=0.004), wood)
    for x in (-0.07, 0.07):
        at = Matrix.Translation((x, -0.024, 0.09)) @ Matrix.Rotation(math.pi / 2, 4, 'X')
        b.add(cyl(0.058, 0.006, 0, segs=40, bevel=0.002), steel, at)
        b.add(cyl(0.052, 0.002, 0.006, segs=40), DIAL, at)
        b.add(box(-0.002, 0.002, -0.034, -0.03, 0.09, 0.135), NEEDLE, Matrix.Translation((x, 0, 0)) @ Matrix.Rotation(-0.6 if x < 0 else 0.4, 4, 'Y').copy())
    return b.done()


def headrest():
    """Slatted wedge headrest, 380 mm wide, rising towards -y (the front of the part)."""
    b = Builder('headrest')
    slat, side = kit('bench'), kit('benchPanel')
    slope = 0.36
    rot = Matrix.Rotation(-slope, 4, 'X')  # rises towards -y, i.e. the part's front
    for i in range(8):
        x = -0.17 + i * 0.0485
        b.add(box(x - 0.017, x + 0.017, -0.18, 0.18, -0.008, 0.008, bevel=0.005), slat, Matrix.Translation((0, 0, 0.075)) @ rot)
    for x in (-0.195, 0.195):
        bm = bmesh.new()
        pts = [(-0.17, 0.0), (0.17, 0.0), (-0.17, 0.135)]
        vs = [bm.verts.new((x - 0.009, py, pz)) for py, pz in pts] + [bm.verts.new((x + 0.009, py, pz)) for py, pz in pts]
        bm.faces.new([vs[0], vs[1], vs[2]])
        bm.faces.new([vs[5], vs[4], vs[3]])
        for a, c in ((0, 1), (1, 2), (2, 0)):
            bm.faces.new([vs[c], vs[a], vs[a + 3], vs[c + 3]])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        b.add(bm, side)
    return b.done()


def bucket():
    """Wooden bucket of 18 staves with steel bands, a white liner and a ladle."""
    b = Builder('bucket')
    wood, steel, white = kit('benchPanel'), kit('steel'), kit('white')
    n = 18
    for i in range(n):
        a = 2 * math.pi * i / n
        st = box(-0.021, 0.021, -0.008, 0.008, 0, 0.2, bevel=0.003, segs=1)
        b.add(st, wood, Matrix.Translation((0.125 * math.cos(a), 0.125 * math.sin(a), 0)) @ Matrix.Rotation(a + math.pi / 2, 4, 'Z') @ Matrix.Rotation(-0.08, 4, 'X'))
    b.add(cyl(0.112, 0.17, 0.015, segs=36, r2=0.123, cap=False), white)
    b.add(cyl(0.112, 0.004, 0.015, segs=36), white)
    for z, r in ((0.05, 0.131), (0.16, 0.14)):
        b.add(torus(r, 0.004, z, segs=48, rsegs=6), steel)
    # Ladle: wooden handle resting on the rim, cup in the bucket.
    handle = cyl(0.009, 0.4, 0, segs=12)
    b.add(handle, wood, Matrix.Translation((0.02, 0, 0.08)) @ Matrix.Rotation(-0.95, 4, 'Y'))
    cup = cyl(0.035, 0.05, 0, segs=20, r2=0.04)
    b.add(cup, wood, Matrix.Translation((-0.05, 0, 0.06)))
    return b.done()


def control():
    """Digital control on the outside wall: rounded black unit with a lit display."""
    b = Builder('control')
    b.add(box(-0.055, 0.055, -0.018, 0, 0, 0.17, bevel=0.008, segs=3), kit('black'))
    b.add(box(-0.035, 0.035, -0.0195, -0.017, 0.1, 0.135, bevel=0.002), kit('led'))
    b.add(cyl(0.014, 0.006, 0, segs=24, bevel=0.002), kit('steel'), Matrix.Translation((0, -0.018, 0.055)) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
    return b.done()


def door_handle():
    """Vertical wooden bar handle on two steel standoffs (both faces of a door)."""
    b = Builder('door-handle')
    wood, steel = kit('bench'), kit('steel')
    for side in (-1, 1):
        y = side * 0.05
        b.add(box(-0.016, 0.016, y - 0.013, y + 0.013, -0.2, 0.2, bevel=0.008, segs=3), wood)
        for z in (-0.15, 0.15):
            b.add(cyl(0.008, 0.045, 0, segs=12), steel, Matrix.Translation((0, 0, z)) @ Matrix.Rotation(math.pi / 2, 4, 'X') @ Matrix.Translation((0, 0, -0.05)))
    return b.done()


def hinge():
    """Glass-door hinge: a bevelled steel block (both faces)."""
    b = Builder('hinge')
    b.add(box(-0.03, 0.03, -0.018, 0.018, -0.045, 0.045, bevel=0.004, segs=2), kit('steel'))
    return b.done()


def main():
    electric_heater('heater-electric', 0.4, 0.7, 0.3, 3)
    electric_heater('heater-electric-large', 0.46, 0.78, 0.34, 7)
    storage_heater(5)
    stove(9)
    ir_panel()
    thermometer()
    headrest()
    bucket()
    control()
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True, export_vertex_color='MATERIAL', export_normals=True, export_materials='EXPORT')
    print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB')


main()
