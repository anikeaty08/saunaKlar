# Blender tools for the kit saunas

Run every script with Blender's Python. `pip install bpy` (Blender 5.2) in a venv works headless; so does `blender -b -P <script> -- <args>`.

| Script | What it makes |
| --- | --- |
| `kit_parts.py` | `apps/web/src/three/kit/assets/kit-parts.glb`: detailed fixtures (heaters with stones, IR panel, dials, headrest, bucket, control). The configurator places them and swaps `kit:<slot>` materials for the chosen finishes. |
| `wood_textures.py` | Tileable stone-pine, clear-grain and slat maps plus normal maps, and `wood.json` (mean colours used for tinting). |
| `render_catalogue.py` | Photo-quality Cycles pictures (outside and inside) of a sauna exported from the app. |

## Catalogue renders

1. Export the scenes: serve `export/export-scenes.ts` with Vite (an `index.html` that loads it), open it in a browser and call `exportAll()`. It returns, for each catalogue model in its default options, a GLB of the built sauna plus its lamps and inside viewpoint; save each GLB as `out/<slug>.glb` and the rest as `out/models.json`.
2. Render: `python tools/blender/render_catalogue.py out/<slug>.glb <slug> renders both 64`.

Brightness can be tuned with the env vars at the top of `render_catalogue.py` (`EXT_SKY`, `INT_LAMP`, `LED`, `INT_EXP`, `RES`, ...).
