# @saunaklar/catalog-import

Adds and updates saunas, rooms and their 3D files without redeploying (design 18.4). A catalog
is a directory of YAML manifests that is checked into the repository and reviewed like code:

```
catalog/
  attributes.yaml          shared attribute dictionary (every attribute code used must be declared)
  saunas/<anything>.yaml   one `sauna:` per file
  rooms/<anything>.yaml    one `room:` per file
  models/, images/         source files, referenced by paths relative to the manifest
```

## Usage

```sh
npx catalog-import tools/catalog-import/examples --dry-run         # validate + plan, write nothing
npx catalog-import tools/catalog-import/examples                   # import into $DATABASE_URL, files to var/objects/
npx catalog-import catalog --target s3://saunaklar-prod-assets --media-bucket saunaklar-prod-media \
  --database-url "$DATABASE_URL"
```

| Option | Meaning |
|---|---|
| `--dry-run` | Validate and print the plan. Nothing is uploaded or written. |
| `--validate-only` | Check manifests and files only (no database), e.g. in a PR check. |
| `--database-url` | Defaults to `$DATABASE_URL`, then `postgres://sauna:sauna@127.0.0.1:5432/sauna`. |
| `--target` | `local` (default: `<repo>/var/objects/<key>`) or `s3://<assets-bucket>`. |
| `--media-bucket` | Public bucket for `media/*` keys with an S3 target (default `$MEDIA_BUCKET`). |
| `--var-dir` | Local var directory (default `<repo root>/var`). |
| `--manufacturer` | Owner of new saunas/rooms (name or uuid), needed only when several exist. |
| `--allow-oversize` | Turns the model size budget errors (design A3) into warnings. |

Exit codes: `0` success or nothing to do; `1` invalid catalog, blocked or rolled-back item;
`2` usage or infrastructure error (bad arguments, database unreachable, upload failed).
Colours are used only when stdout is a TTY (and `NO_COLOR` is unset).

## Pipeline

1. **Validate** - schema (Zod), cross-file checks and rules, files:
   - money is a decimal string in the currency's minor units (`"12900.00"`, parsed with
     `@saunaklar/pricing` `toMinor`); `max_discount_pct` has at most two decimals and becomes
     basis points exactly (`12.5` → 1250);
   - **C4**: every option of a sauna has a price in every currency of `prices` (`"0.00"` allowed);
   - option codes are unique within a group and within a sauna; SKUs, slugs and room codes are
     unique across files; shared option groups/options are described identically everywhere;
   - attributes are declared in `attributes.yaml` and match its type;
   - rules: no option both requires and excludes another, no requirement chain that reaches two
     excluded options or two options of one SINGLE group, at most one default per SINGLE group,
     defaults that do not exclude each other;
   - files: `.glb` has the `glTF` magic, container version 2, a matching length and a JSON chunk
     with `asset.version` 2.x; `.usdz` is a zip; images match their extension. Size budgets:
     high LOD ≤ 12 MB, low LOD ≤ 1.5 MB, AR ≤ 5 MB (error unless `--allow-oversize`).
2. **Optimise** - a pluggable hook (`Optimiser`). When `gltf-transform` (`@gltf-transform/cli`)
   is on `PATH` it runs `optimize` per role (dedup/prune/weld, meshopt + KTX2; the low LOD is also
   simplified with 1024 px textures; the AR GLB uses Draco + WebP). Otherwise the source files are
   uploaded as they are and a warning is printed.
3. **Plan** - diff against the database by natural keys (SKU, option group code, option code,
   attribute code, room code, storage key), printed as `+` create, `~` update, `-` remove. Live
   pre-checks report blockers such as a currency that a reseller still sells in.
4. **Upload** - through the `ObjectStore` interface (`put(key, bytes, contentType, cacheControl)`).
   Keys are content-addressed, `{tier}/catalog/{slug}/{role}-{sha256[0..12]}.{ext}`, where the
   tier is `assets/lo` (MODEL_GLB_LOW, ROOM_GLB_LOW), `assets/hi` (MODEL_GLB_HIGH, MODEL_AR_GLB,
   MODEL_AR_USDZ, ROOM_GLB_HIGH) or `media` (thumbnails, gallery). Rooms use `rooms/{code}` as the
   owner segment. Objects are immutable (`Cache-Control: public, max-age=31536000, immutable`),
   so an existing key is never rewritten. Locally the key is a path under `var/objects/`; on S3
   `assets/*` goes to the private bucket and `media/*` to the public one.
5. **Apply** - one transaction per sauna and per room, as role `catalog_admin` (`withTx` from
   `@saunaklar/db`). Upserts only touch rows whose values differ, so a re-run is a no-op and the
   next plan is empty. Model-level rows the manifest no longer lists are removed (translations,
   attributes, prices, model option groups/options, option prices, rules, asset links). Shared
   option groups, options, their translations and attribute definitions are created and updated
   but never deleted. Reseller assignments are never touched: if a removal would leave an
   assigned sauna without a price in the reseller's currency, the database rejects the
   transaction and the error names the reseller. A failed sauna is rolled back completely; the
   others still import.
6. **Bump** - `bump_all_catalog_versions()` once, only when something was applied.

## Sauna manifest

```yaml
sauna:
  sku: NL-ESP-161              # natural key: upper-case letters, digits, "-" (2-40)
  slug: espoo-glass            # URL slug, unique
  status: ACTIVE               # DRAFT (default) | ACTIVE | RETIRED
  name: Espoo Glass
  description: The Espoo Compact with a full glass front.
  sort: 10                     # catalog order (default 0)
  translations:                # per locale ("fi", "sv-FI"); locales not listed are removed
    de: { name: Espoo Glass, description: Die Espoo Compact mit Glasfront. }
  attributes:                  # code → number | text | boolean, declared in attributes.yaml
    width_mm: 1600
    heater_kw: 6
    interior_wood: Nordic spruce
    outdoor: false
  prices:                      # every currency the sauna is sold in
    EUR: { list_price: "7490.00", max_discount_pct: 15 }
    CHF: { list_price: "7190.00", max_discount_pct: 12.5 }
  option_groups:               # shared catalog entities keyed by code
    wood:
      name: Wood
      selection: SINGLE        # SINGLE | MULTI (shared: must match everywhere)
      required: true           # per sauna
      sort: 0                  # per sauna (default: position in the file)
      translations: { de: Holzart }
      options:
        - code: spruce
          name: Nordic spruce
          description: Light, resinous and fragrant.
          swatch: "#e8d4a8"     # optional hex colour
          default: true         # per sauna; at most one per SINGLE group
          translations: { de: Nordische Fichte }   # or { de: { name: ..., description: ... } }
        - { code: thermo-aspen, name: Thermo-aspen, swatch: "#8a5a3b" }
    extras:
      name: Extras
      selection: MULTI
      options:
        - { code: led-backrest, name: LED backrest lighting }
        - { code: audio, name: Bluetooth audio system }
  option_prices:               # EVERY option × EVERY currency in `prices` (C4); "0.00" = included
    EUR: { spruce: "0.00", thermo-aspen: "790.00", led-backrest: "240.00", audio: "490.00" }
    CHF: { spruce: "0.00", thermo-aspen: "760.00", led-backrest: "230.00", audio: "470.00" }
  rules:
    requires:                  # option → option it needs
      - { audio: led-backrest }
    excludes:                  # pairs that cannot be chosen together
      - [thermo-aspen, audio]
  assets:                      # paths relative to this file; all optional
    model_high: ../models/espoo-compact.glb    # MODEL_GLB_HIGH  ≤ 12 MB
    model_low: ../models/espoo-compact-low.glb # MODEL_GLB_LOW   ≤ 1.5 MB
    ar_glb: ../models/espoo-compact-ar.glb     # MODEL_AR_GLB    ≤ 5 MB
    ar_usdz: ../models/espoo-compact.usdz      # MODEL_AR_USDZ   ≤ 5 MB
    thumbnail: ../images/espoo.webp            # MODEL_THUMBNAIL (png, jpg, webp, avif)
    gallery: [../images/espoo-1.jpg]           # MODEL_GALLERY, ordered
```

## Room manifest

```yaml
room:
  code: scandinavian-bathroom
  name: Scandinavian bathroom
  description: Large-format tiles and a pale wall.
  status: ACTIVE
  sort: 30
  translations:
    de: { name: Skandinavisches Bad }
  preset:                      # parametric room for scenes without a GLB
    widthMm: 3600
    depthMm: 3000
    heightMm: 2600
    floor: tiles               # oak | concrete | tiles | stone | decking
    wallColor: "#e9e5dd"
    windowWall: east           # north | east | south | west | none (default)
  assets:                      # optional
    scene: ../models/bathroom.glb        # ROOM_GLB_HIGH
    scene_low: ../models/bathroom-lo.glb # ROOM_GLB_LOW
    thumbnail: ../images/bathroom.webp   # ROOM_THUMBNAIL
```

## attributes.yaml

```yaml
attributes:
  width_mm:      { label: Width, unit: mm, type: number, sort: 0 }   # number | text | boolean
  interior_wood: { label: Interior wood, type: text, sort: 6 }
```

Attribute definitions are created and updated, never removed (other saunas may use them).

## Tests

`test/validate.unit.test.ts` (no database) and `test/import.db.test.ts` (fresh database per
file via `createTestDatabase()`): `npx vitest run tools/catalog-import`.
