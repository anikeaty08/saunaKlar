"""Render the locally parsed SKP GLB for visual comparison only.

Run with Blender: blender -b --python tools/blender/render_skp_reference.py --
    --input reference.glb --output reference.png
The source remains untouched. GLB coordinates are in millimetres and offset
from the origin; this script recentres and converts them to metres for a view.

--view iso (default, docs/previews/source-skp-exterior.png), front (straight
on, looking from the glass towards the back wall) or plan (from above, back
wall at the top). The same orthographic cameras exist in
apps/web/src/three/reference/preview.tsx (?view=iso|front|plan) for
side-by-side checks. In this frame x runs from the back wall (-1.506) to the
front glass posts (+0.794), y along the back wall, z up; the browser frame is
x = y, y = z + 1.146, z = x + 0.356.
"""

import math

import argparse
import sys

import bpy
from mathutils import Vector


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--camera-x", type=float, default=4.5)
    parser.add_argument("--camera-y", type=float, default=-4.6)
    parser.add_argument("--camera-z", type=float, default=3.0)
    parser.add_argument("--hide-glass", action="store_true")
    parser.add_argument("--view", choices=["iso", "front", "plan"], default="iso")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=args.input)
    source = list(bpy.context.scene.objects)
    if args.hide_glass:
        for obj in source:
            if "202_255_254" in obj.name:
                obj.hide_render = True
    centre = Vector((-18382.9785, 13753.9565, 1143.9830))
    controller = bpy.data.objects.new("SKP reference frame", None)
    bpy.context.collection.objects.link(controller)
    for obj in source:
        if obj.parent is None:
            obj.parent = controller
    controller.scale = (0.001, 0.001, 0.001)
    controller.location = -centre * 0.001

    camera_data = bpy.data.cameras.new("Comparison camera")
    camera = bpy.data.objects.new("Comparison camera", camera_data)
    bpy.context.collection.objects.link(camera)
    target = Vector((0, 0, 0.0))
    if args.view == "front":
        camera.location = (8.0, 0.0, 0.0)
        camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    elif args.view == "plan":
        # Centre on the real cabin (its overall bounding box includes stray geometry in front).
        camera.location = (-0.356, 0.0, 8.0)
        camera.rotation_euler = (0.0, 0.0, math.pi / 2)
    else:
        camera.location = (args.camera_x, args.camera_y, args.camera_z)
        camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 5.2
    bpy.context.scene.camera = camera

    light_data = bpy.data.lights.new("Softbox", "AREA")
    light = bpy.data.objects.new("Softbox", light_data)
    bpy.context.collection.objects.link(light)
    light.location = (-2.5, -2.5, 5)
    light_data.energy = 800
    light_data.shape = "DISK"
    light_data.size = 5
    light.rotation_euler = (target - light.location).to_track_quat("-Z", "Y").to_euler()

    world = bpy.data.worlds.new("Comparison world")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.70, 0.70, 0.70, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = args.output
    scene.view_settings.view_transform = "AgX"
    bpy.ops.render.render(write_still=True)
    print(f"Rendered source comparison to {args.output}")


if __name__ == "__main__":
    main()
