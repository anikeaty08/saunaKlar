"""
Photo-quality catalogue pictures of the kit saunas, rendered with Cycles.

    python tools/blender/render_catalogue.py <scene.glb> <models.json entry slug> <out-dir> [exterior|interior|both] [samples]

The GLB is the sauna exactly as the configurator builds it (exported from the
app with three's GLTFExporter, materials named after the kit's slots), so the
picture shows the same model, options and finishes. Blender adds what a live
view can only fake: daylight from a physical sky, light bouncing round the
room, LED strips and lamps that really light the wood, real glass.
"""

import json
import math
import os
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
GLB, SLUG, OUT = args[0], args[1], args[2]
WHICH = args[3] if len(args) > 3 else 'both'
SAMPLES = int(args[4]) if len(args) > 4 else 96
# Calibrated against the owner's photos; override with env vars while tuning.
EXT_SKY = float(os.environ.get('EXT_SKY', 0.12))
EXT_EXP = float(os.environ.get('EXT_EXP', -0.3))
INT_SKY = float(os.environ.get('INT_SKY', 0.05))
INT_LAMP = float(os.environ.get('INT_LAMP', 10))
EXT_LAMP = float(os.environ.get('EXT_LAMP', 6))
LED = float(os.environ.get('LED', 5))
INT_EXP = float(os.environ.get('INT_EXP', -0.6))
RES = tuple(int(x) for x in os.environ.get('RES', '1500x1000').split('x'))
META = next(m for m in json.load(open(os.path.join(os.path.dirname(GLB), 'models.json'))) if m['slug'] == SLUG)


def v3(p):
    """three.js (x, y, z), y up -> Blender (x, -z, y), z up."""
    return Vector((p[0], -p[2], p[1]))


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


def principled(m):
    return next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if m.use_nodes else None


def emission_only(m, color, strength):
    nt = m.node_tree
    nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*color, 1)
    em.inputs['Strength'].default_value = strength
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs[0], out.inputs[0])


def glass(m, tint, rough):
    nt = m.node_tree
    nt.nodes.clear()
    g = nt.nodes.new('ShaderNodeBsdfGlass')
    g.inputs['Color'].default_value = (*tint, 1)
    g.inputs['Roughness'].default_value = rough
    g.inputs['IOR'].default_value = 1.5
    # Thin pane: let shadows pass so the room is not dark behind single glass.
    lp = nt.nodes.new('ShaderNodeLightPath')
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    tr.inputs['Color'].default_value = (*tint, 1)
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(lp.outputs['Is Shadow Ray'], mix.inputs[0])
    nt.links.new(g.outputs[0], mix.inputs[1])
    nt.links.new(tr.outputs[0], mix.inputs[2])
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(mix.outputs[0], out.inputs[0])


def setup_materials():
    for m in bpy.data.materials:
        name = m.name.split('.')[0]
        p = principled(m)
        if name in ('glass', 'doorGlass'):
            base = p.inputs['Base Color'].default_value if p else (0.9, 0.95, 0.95, 1)
            satin = p is not None and p.inputs['Roughness'].default_value > 0.3
            tint = tuple(min(1.0, 0.55 + 0.45 * c) for c in base[:3])
            glass(m, tint, 0.25 if satin else 0.0)
        elif name == 'led':
            emission_only(m, hex_rgb('#ffd6a8'), LED)
        elif name == 'fire':
            emission_only(m, hex_rgb('#ff7a2e'), 12)
        elif p is not None:
            if name in ('wallIn', 'wallOut', 'ceiling', 'bench', 'benchPanel', 'roof'):
                p.inputs['Roughness'].default_value = max(0.55, p.inputs['Roughness'].default_value)
                if 'Coat Weight' in p.inputs:
                    p.inputs['Coat Weight'].default_value = 0.0
            if name == 'grille' or name.startswith('ir-ceramic'):
                p.inputs['Emission Strength'].default_value = 0.6


def world(strength=1.0, sun_elev=32, sun_rot=215):
    w = bpy.data.worlds.new('sky')
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    sky = nt.nodes.new('ShaderNodeTexSky')
    for t in ('MULTIPLE_SCATTERING', 'SINGLE_SCATTERING', 'NISHITA'):
        try:
            sky.sky_type = t
            break
        except TypeError:
            continue
    sky.sun_elevation = math.radians(sun_elev)
    sky.sun_rotation = math.radians(sun_rot)
    if hasattr(sky, 'sun_intensity'):
        sky.sun_intensity = 0.6
    # A little haze, so the horizon reads like real air rather than a painted band.
    for attr, val in (('dust_density', 3.0), ('air_density', 1.4)):
        if hasattr(sky, attr):
            setattr(sky, attr, val)
    bg = nt.nodes['Background']
    bg.inputs['Strength'].default_value = strength
    nt.links.new(sky.outputs['Color'], bg.inputs['Color'])


def ground():
    bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, -0.001))
    g = bpy.context.object
    m = bpy.data.materials.new('ground')
    m.use_nodes = True
    p = principled(m)
    nt = m.node_tree
    # Fine gravel/paving: noise drives colour and a little bump.
    tex = nt.nodes.new('ShaderNodeTexNoise')
    tex.inputs['Scale'].default_value = 60
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (0.33, 0.32, 0.30, 1)
    ramp.color_ramp.elements[1].color = (0.47, 0.46, 0.43, 1)
    nt.links.new(tex.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], p.inputs['Base Color'])
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.15
    nt.links.new(tex.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], p.inputs['Normal'])
    p.inputs['Roughness'].default_value = 0.9
    g.data.materials.append(m)


def camera(eye, target, lens_fov_deg, name):
    cam_data = bpy.data.cameras.new(name)
    cam_data.sensor_fit = 'VERTICAL'
    cam_data.angle_y = math.radians(lens_fov_deg)
    cam_data.clip_start = 0.02
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = eye
    cam.rotation_euler = (target - eye).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    return cam


def point_lights(lights, scale):
    for i, l in enumerate(lights):
        d = bpy.data.lights.new(f'lamp{i}', 'POINT')
        d.color = hex_rgb(l['color'])
        d.energy = l['intensity'] * scale
        d.shadow_soft_size = 0.06
        o = bpy.data.objects.new(f'lamp{i}', d)
        o.location = v3(l['position'])
        o.visible_camera = False
        o.visible_glossy = False
        o.visible_transmission = False
        bpy.context.scene.collection.objects.link(o)


def render(path, w, h, samples, exposure):
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'
    s.cycles.samples = samples
    s.cycles.use_adaptive_sampling = True
    s.cycles.adaptive_threshold = 0.02
    s.cycles.use_denoising = True
    s.cycles.max_bounces = 8
    s.cycles.diffuse_bounces = 5
    s.cycles.glossy_bounces = 3
    s.cycles.transmission_bounces = 8
    s.cycles.caustics_reflective = False
    s.cycles.caustics_refractive = False
    s.cycles.blur_glossy = 1.0
    s.render.resolution_x, s.render.resolution_y = w, h
    s.render.resolution_percentage = 100
    s.view_settings.view_transform = 'AgX'
    try:
        s.view_settings.look = 'AgX - Medium High Contrast'
    except TypeError:
        pass
    s.view_settings.exposure = exposure
    s.render.image_settings.file_format = 'JPEG'
    s.render.image_settings.quality = 90
    s.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('wrote', path)


def main():
    os.makedirs(OUT, exist_ok=True)
    W, D, H = META['W'], META['D'], META['H']
    r = max(W, D, H)
    for which in (['exterior', 'interior'] if WHICH == 'both' else [WHICH]):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=GLB)
        setup_materials()
        if which == 'exterior':
            world(EXT_SKY)
            ground()
            point_lights(META['lights'], EXT_LAMP)
            eye = v3([r * 1.5, H * 0.75 + r * 0.25, r * 2.05])
            camera(eye, v3([0, H * 0.46, 0]), 30, 'cam')
            render(os.path.join(OUT, f'{SLUG}-exterior.jpg'), RES[0], RES[1], SAMPLES, EXT_EXP)
        else:
            world(INT_SKY)
            ground()
            point_lights(META['lights'], INT_LAMP)
            v = META['view']
            camera(v3(v['eye']), v3(v['look']), 62, 'cam')
            render(os.path.join(OUT, f'{SLUG}-interior.jpg'), RES[0], RES[1], SAMPLES, INT_EXP)


main()
