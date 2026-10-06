# USUNG corporate website

Corporate home for 유성건설 주식회사, with AI, Smart Construction and Physical AI divisions.

## Run

Node 22 or later. No third-party server dependencies.

```
npm run build
PORT=8080 npm start
```

## Routes

- `/` — corporate landing page
- `/ai/` — AI & AX
- `/smart-construction/` — the previous construction experience
- `/physical-ai/` — Physical AI

Shared corporate navigation appears on all four routes. `src/pages.mjs` holds the new page content. `build.mjs` generates HTML and relocates the original construction page with absolute asset paths. The construction layout, video, project filtering and dialogs are retained.

The main landing page is a separate company overview with direct entry cards for all three divisions. Main, AI, Smart Construction and Physical AI are always visible links on every page; on narrow screens they occupy a fixed second navigation row. Division routing uses ordinary links and remains available without a menu toggle or JavaScript.

## Existing site preservation

`baseline/` preserves the construction experience retrieved from the company’s production site on 2026-10-03. Its HTML and script receive scoped asset and branding updates; `baseline/assets.json` retains original acquisition hashes. Reference project descriptions and source links remain available without claiming new company projects. The corporate home has three division media cards. The AI page uses acquired artwork and keyboard-accessible capability tabs; Physical AI uses acquired robotics footage. Runway and Luma are excluded by the owner. Source provenance is recorded in `references.json`. Headers use the same paper surface, black lettering and #FF0F6F accent across all four routes.

The original construction contact dialog retains its brief-download behavior. The new corporate contact links open an email to the company’s published address.

## Production target

- Railway project: `3ed80199-e7ca-4d74-8258-d7cde282d310`
- Railway service: `056dec14-c2b1-4dcb-b152-29782e2ac385`
- Production environment: `f496e79f-dd76-431e-8e7c-2c3b0fc78d90`
- Domains: `usungcorp.com`, `www.usungcorp.com`
- Port: `8080`

Build root: `/products/usung-corporate`. Health endpoint: `/health`.
Previous deployment (recovery baseline): `62b8e0e4-9032-4cdb-af88-a1f7daae8ae3`.

## Approved references (2026-10-03)

`references.json` records source pages, acquired asset URLs, original hashes, served hashes and media transformations. Originals are retained alongside the adapted assets. Existing scenes and aspect ratios are preserved. Posters are frames from the corresponding served videos. The previously approved glass artwork was extended using imagegen.

## Reference branding (2026-10-04)

Visible source-company marks are adapted to the approved USUNG wordmark or U symbol. The original v22 revision used six imagegen photo edits; v24 replaces every one with non-generative edits of the preserved original photographs. Physical AI videos retain their original sequence and timing. Construction films are now selected montages from the higher resolution official reference footage, with source ranges and transformations recorded. Matching posters are frames from the corresponding videos. Three native SVG diagrams receive the outlined USUNG mark. Reference captions are plain text. `reference-branding.json` records transformed assets, their original source identity, served checksums and transformation history. Images and footage with no observed source-company mark remain unchanged.


### Physical AI surface correction (v23)

Four Physical AI videos and their posters are recomposited from preserved originals. Printed joint marks use constrained observations of the original paint, temporal smoothing and visibility masks; body and cloth wordmarks retain perspective tracks. Inserts match source ink brightness, local lighting, texture and focus softness. The source screen-corner watermark is removed without a replacement floating wordmark. Footage duration, frame count, dimensions, frame rate and scenes are preserved. Video files use new v23 URLs; prior files remain available for recovery.

All four footers use white surfaces with the approved black USUNG mark and its pink first-U corner. Standalone wordmarks in visual-reference captions are removed. Text sections use the light site palette, while photographed scene illumination is retained. The asset record preserves source provenance and previous served checksums. Perceptual realism is reviewed visually, not asserted as universally indistinguishable.


### Original photograph and construction-film correction (v24)

Six photographs now start from the acquired originals. Only original printed-brand regions are retouched and composited using source perspective, curvature, ink, illumination and softness. Photographs are delivered as lossless WebP; decoded pixels outside the recorded edit masks are identical to the original JPEG decode. No equipment, sky, people or surrounding scene is regenerated. In particular, the dusk photograph no longer contains the additional invented boom logos.

The v24 construction videos preserved outside-mask pixels, but subsequent visual review found oversized marks, original-letter remnants and failed arm occlusion. Pixel identity did not establish natural-looking branding. Those films are superseded by v25. Previous files remain available for recovery. The existing abstract glass artwork is separate from photographed construction/robotics media and retains its generation provenance.

Do not return to full-frame generative photo edits. Preserve real photographed scenes and make future brand corrections only within verified source-brand masks.


### Camera photograph and 4K source-footage rework (v25)

The previous blue dusk photograph matches Built Robotics’ official HDR download. The Home feature and daylight piling references now use the photographed RPD35 image with a matching Commons camera record (Canon EOS R6, 2024-01-24). The U print replaces only the original B on the vented body; the original AUTONOMOUS MACHINE cab identification is restored. No scene is generated.

Both Smart Construction films use new official 4K source footage, exported at 1920×1080. The equipment film selects original pile-driving, hammer, solar-field, aerial and overhead machinery shots. The delivery film selects the real entrance sign, structural construction and BIM tablet footage. Source-company prints are replaced in their physical planes, including source softness and sun flare. Original safety and operating labels are preserved. Source frame ranges, local masks, checksums and exports are recorded in `media-source-verification.json`. These are visual-reference films, with no claim of USUNG project ownership.

Vest, excavation-panel and robotics-board prints receive further local source-pixel retouching. Physical AI v23 remains unchanged. Visual review and published-byte verification are separate gates; these records do not claim owner visual acceptance or universal photographic indistinguishability.

On phones, the construction hero preserves the full 16:9 source frame. Its heading follows on the light page surface rather than cropping most of the equipment into a portrait video. The pause control retains readable contrast over the footage.

### Three-business Home and helmet correction (v26)

The owner accepted the v25 Smart Construction films and the opening Home landing. Those media files and the opening three-card composition remain unchanged. The navigation now names the division AI & AX. The lower single construction-photo feature is replaced by three open, light-surface chapters for AI & AX, Smart Construction and Physical AI. Each includes an existing approved visual, a short role description and ordinary links to its division. Hitachi's business presentation and Hexagon's digital-to-physical technology structure informed the hierarchy; all three chapters are displayed without switching tabs. Phones retain the full video frame above the copy. All 31 translated business-label suffixes are preserved.

Both helmet-front marks in the original Suffolk team photograph use compact approved U symbols with the pink upper-right corner, replacing distorted wordmarks. Local helmet illumination, grain and focus are matched; the remaining red source-print edge is removed. Faces, hardware, the existing vest repair and yellow side sticker are unchanged. Lossless WebP and recorded masks establish pixel preservation outside the repairs. The evidence lives in `baseline/original-media-v26/`. No photographic scene or footage is generated in this revision. Visual review of the new revision by the owner remains a separate step.

### Smart Construction media and recovery (v37)

The second construction film uses one continuously tracked physical sign plane with a fixed canonical B wordmark. Pigment moves against the accepted photographed substrate; its illumination and camera flare remain intact. Frame-to-frame width jumps and changing letter proportions are corrected. The adjacent SEE/DECIDE photographs now use separate real views, including an acquired overhead excavation photograph. Two lower blue equipment label areas receive source-derived surface treatment and full USUNG marks. Masks, source hashes, track matrices and reproduction inputs are under `baseline/original-media-v37/`. Other accepted footage, AI glass, helmet lettering and navigation remain preserved.

For recoverable releases, use [the private R2 guide](recovery/RESTORE.md) and `recovery/recovery.mjs`. The dedicated selector is `omar-private-archive/usung-corporate/latest.json`; immutable manifests identify exact product commit, release, deployment and full-file integrity. The package is only published as latest after full R2 readback and a clean build/server restoration drill. `recovery/PREVIOUS_V36.json` preserves the previous deployed state’s independently verified immutable Git-bundle coordinates.
