"""Build the six-sided glass-front sauna from measured construction rules.

Reference: `reference of sauna 1.pdf` and `Modell 6-eck mit Glasfront 1.skp`.
The SKP is only a measuring reference. Every mesh below is created afresh from
the requested exterior dimensions; there is no imported cabin or scaled bench.

Run with Blender, for example:
  blender -b --python tools/blender/reference_sauna.py -- \
      --width-mm 3060 --depth-mm 3013 --height-mm 2292 --out sauna.glb

The source reference uses a 3060 mm long bench wall. At that size its long
upper seat is 2974 mm; it has 1022/619 mm upper/lower seat heights.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy


SOURCE_W = 3.060
SOURCE_D = 3.013
SOURCE_H = 2.292
WALL = 0.043
UPPER_REFERENCE = 1.022
LOWER_REFERENCE = 0.619
SEAT_REFERENCE = 0.975
BOARD_PITCH = 0.134
MIN_HEATER_STEP_GAP = 0.025


def polygon_gap(first, second):
    """Plan distance between the heater rectangle and diagonal step."""
    separated = False
    for polygon in (first, second):
        for i, a in enumerate(polygon):
            b = polygon[(i + 1) % len(polygon)]
            axis = (b[1] - a[1], a[0] - b[0])
            p = [point[0]*axis[0] + point[1]*axis[1] for point in first]
            q = [point[0]*axis[0] + point[1]*axis[1] for point in second]
            if max(p) < min(q) or max(q) < min(p):
                separated = True
    if not separated:
        return 0.0

    def point_segment(point, a, b):
        dx, dy = b[0] - a[0], b[1] - a[1]
        fraction = max(0.0, min(1.0,
            ((point[0] - a[0])*dx + (point[1] - a[1])*dy)/(dx*dx + dy*dy)))
        return math.hypot(point[0] - a[0] - fraction*dx,
                          point[1] - a[1] - fraction*dy)

    return min(point_segment(point, edges[i], edges[(i + 1) % len(edges)])
               for points, edges in ((first, second), (second, first))
               for point in points for i in range(len(edges)))


def material(name: str, colour: tuple[float, float, float], roughness: float = 0.72,
             transmission: float = 0.0, emission: float = 0.0) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    shader.inputs["Base Color"].default_value = (*colour, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    if transmission:
        shader.inputs["Transmission Weight"].default_value = transmission
        shader.inputs["IOR"].default_value = 1.45
        # Blender's material viewport does not trace transmission. Alpha keeps
        # the benches visible there and exports as transparent glass in glTF.
        shader.inputs["Alpha"].default_value = 0.18
        mat.surface_render_method = "BLENDED"
    if emission:
        shader.inputs["Emission Color"].default_value = (*colour, 1.0)
        shader.inputs["Emission Strength"].default_value = emission
    return mat


class Sauna:
    def __init__(self, width: float, depth: float, height: float,
                 backrest_light: bool = False, under_bench_light: bool = False):
        if not (2.4 <= width <= 3.6 and 2.4 <= depth <= 3.6 and 2.1 <= height <= 2.7):
            raise ValueError("Supported dimensions: width/depth 2400–3600 mm, height 2100–2700 mm")
        self.width, self.depth, self.height = width, depth, height
        self.backrest_light = backrest_light
        self.under_bench_light = under_bench_light
        self.objects: list[bpy.types.Object] = []
        self.wood = material("Zirbe wall — reference", (0.66, 0.48, 0.29))
        self.bench = material("Espe bench — reference", (0.84, 0.75, 0.58))
        self.floor = material("Dark timber floor — PDF reference", (0.22, 0.14, 0.09), 0.85)
        self.dark = material("Heater and dark metal", (0.065, 0.067, 0.07), 0.36)
        self.metal = material("Brushed metal", (0.5, 0.52, 0.53), 0.28)
        self.glass = material("Clear glass — reference", (0.80, 0.89, 0.88), 0.06, 0.9)
        self.led = material("Warm bench lighting", (1.0, 0.72, 0.38), 0.4, emission=2.2)
        self.stone = material("Sauna stones", (0.18, 0.17, 0.16), 0.95)

        # The source's six-point plan, recentered and reoriented so the long
        # bench wall is the back edge. Values are fractions of W and D.
        self.outline = [
            (-0.5 * width, -0.5 * depth),
            (0.5 * width, -0.5 * depth),
            (0.5 * width, 0.263 * depth),
            (0.476 * width, 0.5 * depth),
            (0.024 * width, 0.263 * depth),
            (-0.5 * width, -0.128 * depth),
        ]
        self.upper_top = min(1.15, max(0.95, height - (SOURCE_H - UPPER_REFERENCE)))
        self.lower_top = self.upper_top - (UPPER_REFERENCE - LOWER_REFERENCE)
        self.upper_depth = min(SEAT_REFERENCE, depth - 1.58)
        if self.upper_depth < 0.65:
            raise ValueError("Cabin depth cannot fit the reference upper bench")
        self.bench_start = -width / 2 + WALL
        self.bench_end = width / 2 - WALL
        self.bench_length = self.bench_end - self.bench_start
        self.return_start = self.bench_end-0.68
        self.return_back = -depth/2+WALL+self.upper_depth
        self.return_front = 0.263*depth-0.073
        def glass_scale(x, y):
            return (x*width/SOURCE_W, y*depth/SOURCE_D)
        glass_start = glass_scale(-1.174, -0.408)
        door_start = glass_scale(-0.354, -0.408)
        middle_end = glass_scale(0.088, 0.772)
        glass_end = glass_scale(1.480, 0.772)
        diagonal_length = math.dist(door_start, middle_end)
        if diagonal_length < 0.92:
            raise ValueError("Cabin cannot fit the measured glass door and fixed pane")
        door_end = (door_start[0]+(middle_end[0]-door_start[0])*0.72/diagonal_length,
                    door_start[1]+(middle_end[1]-door_start[1])*0.72/diagonal_length)
        self.glass_path = [glass_start, door_start, door_end, middle_end, glass_end]
        # The source's lower step is a diagonal strip under the upper L, not
        # a second straight wall-to-wall bench. Corners are source metres,
        # normalized against the measured outer W/D.
        source_lower_corners = [
            (-0.304*width/SOURCE_W, -0.466*depth/SOURCE_D),
            (0.768*width/SOURCE_W, 0.431*depth/SOURCE_D),
            (1.204*width/SOURCE_W, -0.090*depth/SOURCE_D),
            (0.128*width/SOURCE_W, -0.985*depth/SOURCE_D),
        ]
        self.heater_xy = (0.35, min(0.53*depth/SOURCE_D, middle_end[1]-0.235))
        hx, hy = self.heater_xy
        heater_bounds = [(hx-0.24, hy-0.21), (hx+0.24, hy-0.21),
                         (hx+0.24, hy+0.21), (hx-0.24, hy+0.21)]

        def lower_at(run):
            a, b, d, c = source_lower_corners
            def between(first, last):
                return (first[0]+(last[0]-first[0])*run,
                        first[1]+(last[1]-first[1])*run)
            return [a, between(a, b), between(c, d), c]

        self.lower_corners = lower_at(1.0)
        if polygon_gap(self.lower_corners, heater_bounds) < MIN_HEATER_STEP_GAP:
            short, long = 0.55, 1.0
            self.lower_corners = lower_at(short)
            if polygon_gap(self.lower_corners, heater_bounds) < MIN_HEATER_STEP_GAP:
                raise ValueError("Cabin cannot fit the lower step and heater")
            for _ in range(24):
                middle = (short + long)/2
                self.lower_corners = lower_at(middle)
                if polygon_gap(self.lower_corners, heater_bounds) >= MIN_HEATER_STEP_GAP:
                    short = middle
                else:
                    long = middle
            self.lower_corners = lower_at(short)

    def add(self, obj: bpy.types.Object, mat: bpy.types.Material):
        obj.data.materials.append(mat)
        self.objects.append(obj)
        return obj

    def box(self, name: str, lo: tuple[float, float, float], hi: tuple[float, float, float],
            mat: bpy.types.Material):
        if any(b - a <= 0 for a, b in zip(lo, hi)):
            return None
        bpy.ops.mesh.primitive_cube_add(size=1)
        obj = bpy.context.object
        obj.name = name
        obj.data.name = name
        obj.location = tuple((a + b) / 2 for a, b in zip(lo, hi))
        obj.scale = tuple(b - a for a, b in zip(lo, hi))
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        return self.add(obj, mat)

    def beam(self, name: str, a: tuple[float, float], b: tuple[float, float],
             z0: float, z1: float, thickness: float, mat: bpy.types.Material):
        length = math.dist(a, b)
        obj = self.box(name, (-length / 2, -thickness / 2, z0),
                       (length / 2, thickness / 2, z1), mat)
        obj.location.x = (a[0] + b[0]) / 2
        obj.location.y = (a[1] + b[1]) / 2
        obj.rotation_euler.z = math.atan2(b[1] - a[1], b[0] - a[0])
        return obj

    def slab(self, name: str, points: list[tuple[float, float]], z0: float, z1: float,
             mat: bpy.types.Material):
        n = len(points)
        verts = [(x, y, z) for z in (z0, z1) for x, y in points]
        faces = [tuple(reversed(range(n))), tuple(range(n, 2*n))]
        faces.extend((i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n))
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        return self.add(obj, mat)

    def shell(self):
        self.slab("Continuous floor", self.outline, -0.045, 0, self.floor)
        self.slab("Flat timber ceiling", self.outline, self.height - 0.06, self.height, self.wood)
        for i in (0, 1, 2, 5):
            a, b = self.outline[i], self.outline[(i+1)%6]
            count = max(1, math.ceil((self.height - 0.06) / BOARD_PITCH))
            for row in range(count):
                z0 = row * (self.height - 0.06) / count
                z1 = (row + 1) * (self.height - 0.06) / count - 0.002
                self.beam(f"Wall {i} board {row}", a, b, z0, z1, WALL, self.wood)

        # The source glass follows four interior segments under the faceted
        # roof. The second segment is a 720 mm door, even in narrow cabins.
        count = max(1, math.ceil((self.height - 0.06) / BOARD_PITCH))
        for row in range(count):
            z0 = row * (self.height - 0.06) / count
            z1 = (row + 1) * (self.height - 0.06) / count - 0.002
            self.beam(f"Glass-side timber cheek board {row}",
                      self.outline[5], self.glass_path[0], z0, z1, WALL, self.wood)
        for i in range(4):
            a, b = self.glass_path[i], self.glass_path[i+1]
            length = math.dist(a, b)
            direction = ((b[0]-a[0])/length, (b[1]-a[1])/length)
            def at(u): return (a[0]+direction[0]*u, a[1]+direction[1]*u)
            if i == 1:
                self.beam("Clear glass door", at(0.008), at(length-0.008),
                          0.015, min(1.95, self.height-0.14), 0.008, self.glass)
                handle = at(0.105)
                self.box("Door handle", (handle[0]-0.015, handle[1]-0.035, 0.83),
                         (handle[0]+0.015, handle[1]+0.035, 1.21), self.wood)
                for hinge_height in (0.36, 1.55):
                    self.box("Door hinge", (b[0]-0.020, b[1]-0.020, hinge_height),
                             (b[0]+0.020, b[1]+0.020, hinge_height+0.045), self.metal)
            else:
                self.beam("Faceted full-height glass", at(0.015), at(length-0.015),
                          0.025, self.height-0.085, 0.008, self.glass)
            self.beam("Glass head rail", a, b, self.height-0.10, self.height-0.06,
                      0.045, self.wood)
            self.beam("Glass foot rail", a, b, 0, 0.025, 0.045, self.metal)
            if i in (0, 3):
                jamb = a if i == 0 else b
                self.box("Glass timber jamb", (jamb[0]-0.024, jamb[1]-0.024, 0),
                         (jamb[0]+0.024, jamb[1]+0.024, self.height-0.06), self.wood)

    def bench_run(self, name: str, x0: float, x1: float, y0: float, y1: float,
                  top: float, depth: float, waterfall: bool):
        # Longitudinal boards follow the cabin width; the count changes with
        # cabin depth, while board widths stay close to the photographed ones.
        count = max(4, round((depth + 0.012) / 0.102))
        gap = 0.012
        slat = (depth - (count-1)*gap) / count
        for i in range(count):
            yy = y0 + i*(slat+gap)
            self.box(f"{name} seat slat {i}", (x0, yy, top-0.028),
                     (x1, yy+slat, top), self.bench)
        # Supports are tied to the seat length, never placed at fixed x.
        supports = max(2, math.ceil((x1-x0)/0.60)+1)
        for i in range(supports):
            x = x0 + 0.04 + (x1-x0-0.08)*i/(supports-1)
            self.box(f"{name} support {i}", (x-0.022, y0+0.03, top-0.09),
                     (x+0.022, y1-0.03, top-0.028), self.bench)
        if waterfall:
            # The PDF's visible end is vertically slatted, with the number of
            # boards derived from the seat depth.
            for end_x in (x0, x1-0.028):
                count = max(3, round(depth/0.084))
                step = depth/count
                for i in range(count):
                    yy = y0+i*step
                    self.box(f"{name} waterfall", (end_x, yy, 0.07),
                             (end_x+0.028, yy+step-0.010, top-0.028), self.bench)
        # Front cladding sits under the seat, with an illuminated recess.
        front_y = y1-0.024
        rows = max(2, round((top-0.12)/0.115))
        for i in range(rows):
            z0 = 0.08+i*(top-0.14)/rows
            z1 = 0.08+(i+1)*(top-0.14)/rows-0.008
            self.box(f"{name} front board {i}", (x0, front_y, z0),
                     (x1, front_y+0.024, z1), self.bench)
        if self.under_bench_light:
            self.box(f"{name} under-seat light", (x0+0.08, y1-0.048, top-0.065),
                     (x1-0.08, y1-0.034, top-0.055), self.led)

    def seating(self):
        back_y = -self.depth/2+WALL
        upper_front = back_y+self.upper_depth
        self.bench_run("Upper bench", self.bench_start, self.bench_end,
                       back_y, upper_front, self.upper_top, self.upper_depth, True)
        # Cross bench: longitudinal boards along the right wall at the same
        # upper level. Its front end follows the wall/glass junction.
        return_width = self.bench_end-self.return_start
        count = max(4,round((return_width+0.012)/0.102))
        slat = (return_width-(count-1)*0.012)/count
        for i in range(count):
            x=self.return_start+i*(slat+0.012)
            self.box(f"Upper return seat slat {i}",
                     (x,self.return_back,self.upper_top-0.028),
                     (x+slat,self.return_front,self.upper_top),self.bench)
        for z in (self.return_back+0.10,self.return_front-0.10):
            self.box("Upper return support",(self.return_start+0.03,z-0.025,self.upper_top-0.09),
                     (self.bench_end-0.03,z+0.025,self.upper_top-0.028),self.bench)
        for row in range(max(2,round((self.upper_top-0.12)/0.115))):
            rows=max(2,round((self.upper_top-0.12)/0.115))
            y0=0.08+row*(self.upper_top-0.14)/rows
            y1=0.08+(row+1)*(self.upper_top-0.14)/rows-0.008
            self.box(f"Upper return front board {row}",
                     (self.return_start,self.return_back,y0),
                     (self.return_start+0.024,self.return_front,y1),self.bench)

        # Seven or so diagonal lower slats, with their length and direction
        # recalculated from the four corners as the cabin changes size.
        a,b,d,c=self.lower_corners
        width=math.dist(a,c)
        count=max(4,round((width+0.012)/0.102))
        slat=(width-(count-1)*0.012)/count
        for i in range(count):
            t=(i*(slat+0.012)+slat/2)/width
            start=(a[0]+(c[0]-a[0])*t,a[1]+(c[1]-a[1])*t)
            end=(b[0]+(d[0]-b[0])*t,b[1]+(d[1]-b[1])*t)
            self.beam(f"Diagonal lower seat slat {i}",start,end,
                      self.lower_top-0.028,self.lower_top,slat,self.bench)
        for t in (0.10,0.90):
            start=(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t)
            end=(c[0]+(d[0]-c[0])*t,c[1]+(d[1]-c[1])*t)
            self.beam("Diagonal lower support",start,end,
                      self.lower_top-0.09,self.lower_top-0.028,0.045,self.bench)
        # Vertical waterfall boards at the photographed exposed lower end.
        end_width=math.dist(b,d)
        end_count=max(3,round((end_width+0.012)/0.084))
        end_board=(end_width-(end_count-1)*0.012)/end_count
        for i in range(end_count):
            u0=i*(end_board+0.012)/end_width
            u1=(i*(end_board+0.012)+end_board)/end_width
            first=(b[0]+(d[0]-b[0])*u0,b[1]+(d[1]-b[1])*u0)
            last=(b[0]+(d[0]-b[0])*u1,b[1]+(d[1]-b[1])*u1)
            self.beam(f"Diagonal lower end slat {i}",first,last,
                      0.07,self.lower_top-0.028,0.028,self.bench)
        self.beam("Diagonal lower end foot rail",b,d,0.04,0.07,0.03,self.bench)
        # Backrests and LED strip use the very same x bounds as the seat.
        for row in range(3):
            z0 = self.upper_top+0.16+row*0.12
            self.box(f"Backrest {row}", (self.bench_start+0.06, back_y+0.025, z0),
                     (self.bench_end-0.06, back_y+0.050, z0+0.085), self.bench)
            self.box(f"Return backrest {row}",
                     (self.bench_end-0.050, self.return_back+0.060, z0),
                     (self.bench_end-0.025, self.return_front-0.060, z0+0.085), self.bench)
        if self.backrest_light:
            self.box("Backrest light", (self.bench_start+0.08, back_y+0.012,
                                        self.upper_top+0.49),
                     (self.bench_end-0.08, back_y+0.022, self.upper_top+0.502), self.led)

    def heater(self):
        # The heater stays in the measured free-floor region as depth changes.
        x, y = self.heater_xy
        self.box("Heater body", (x-0.24,y-0.21,0.02),
                 (x+0.24,y+0.21,0.95), self.dark)
        for side_y in (y-0.211, y+0.191):
            self.box("Heater timber rim", (x-0.241,side_y,0.88),
                     (x+0.241,side_y+0.020,0.945), self.bench)
        for side_x in (x-0.241, x+0.221):
            self.box("Heater timber rim", (side_x,y-0.191,0.88),
                     (side_x+0.020,y+0.191,0.945), self.bench)
        for i in range(7):
            angle = i*2.399963
            r = 0.04+0.11*math.sqrt((i+1)/7)
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=0, radius=0.065,
                                                  location=(x+r*math.cos(angle),y+r*math.sin(angle),0.98))
            bpy.context.object.name = f"Heater stone {i}"
            bpy.context.object.data.name = f"Heater stone {i}"
            self.add(bpy.context.object, self.stone)

    def build(self):
        self.shell()
        self.seating()
        self.heater()
        return self.objects


def main():
    args = argparse.ArgumentParser()
    args.add_argument("--width-mm", type=int, default=3060)
    args.add_argument("--depth-mm", type=int, default=3013)
    args.add_argument("--height-mm", type=int, default=2292)
    args.add_argument("--backrest-light", action="store_true")
    args.add_argument("--under-bench-light", action="store_true")
    args.add_argument("--out", type=Path, required=True)
    opts = args.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    bpy.ops.object.select_all(action="DESELECT")
    model = Sauna(opts.width_mm/1000,opts.depth_mm/1000,opts.height_mm/1000,
                  backrest_light=opts.backrest_light,
                  under_bench_light=opts.under_bench_light)
    objects = model.build()
    for obj in objects: obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    opts.out.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(opts.out),export_format="GLB",
                              use_selection=True,export_apply=True)
    manifest = {
        "schemaVersion": 1,
        "source": "reference-sauna-parametric-v1",
        "model": opts.out.name,
        "units": "mm",
        "dimensions": {"width": opts.width_mm, "depth": opts.depth_mm,
                       "height": opts.height_mm},
        "lighting": {"backrest": opts.backrest_light,
                     "underBench": opts.under_bench_light},
        "bench": {
            "upper": {"length": round(model.bench_length*1000),
                      "depth": round(model.upper_depth*1000),
                      "height": round(model.upper_top*1000)},
            "upperReturn": {"length": round((model.return_front-model.return_back)*1000),
                            "width": 680},
            "lower": {"length": round(math.dist(model.lower_corners[0],model.lower_corners[1])*1000),
                      "width": round(math.dist(model.lower_corners[0],model.lower_corners[3])*1000),
                      "height": round(model.lower_top*1000)},
            "supportCount": max(2, math.ceil(model.bench_length/0.60)+1),
        },
    }
    opts.out.with_suffix(".json").write_text(json.dumps(manifest, indent=2),
                                            encoding="utf-8")
    print(f"wrote {opts.out}: {opts.width_mm}×{opts.depth_mm}×{opts.height_mm} mm; "
          f"upper bench {model.bench_length*1000:.0f}×{model.upper_depth*1000:.0f} mm "
          f"at {model.upper_top*1000:.0f} mm; lower at {model.lower_top*1000:.0f} mm")


if __name__ == "__main__":
    main()
