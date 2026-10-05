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

Visible source-company marks are adapted to the approved USUNG wordmark or U symbol. The original v22 revision used six imagegen photo edits; v24 replaces every one with non-generative edits of the preserved original photographs. Six videos receive native vector compositing on the observed logo regions, retaining scene sequence, frame count, dimensions and frame rate. Four posters are regenerated from these videos. Three native SVG diagrams receive the outlined USUNG mark. Reference captions are plain text. `reference-branding.json` records the 19 transformed assets, served checksums and photo-edit prompt set. Images and footage with no observed source-company mark remain unchanged.


### Physical AI surface correction (v23)

Four Physical AI videos and their posters are recomposited from preserved originals. Printed joint marks use constrained observations of the original paint, temporal smoothing and visibility masks; body and cloth wordmarks retain perspective tracks. Inserts match source ink brightness, local lighting, texture and focus softness. The source screen-corner watermark is removed without a replacement floating wordmark. Footage duration, frame count, dimensions, frame rate and scenes are preserved. Video files use new v23 URLs; prior files remain available for recovery.

All four footers use white surfaces with the approved black USUNG mark and its pink first-U corner. Standalone wordmarks in visual-reference captions are removed. Text sections use the light site palette, while photographed scene illumination is retained. The asset record preserves source provenance and previous served checksums. Perceptual realism is reviewed visually, not asserted as universally indistinguishable.


### Original photograph and construction-film correction (v24)

Six photographs now start from the acquired originals. Only original printed-brand regions are retouched and composited using source perspective, curvature, ink, illumination and softness. Photographs are delivered as lossless WebP; decoded pixels outside the recorded edit masks are identical to the original JPEG decode. No equipment, sky, people or surrounding scene is regenerated. In particular, the dusk photograph no longer contains the additional invented boom logos.

Both construction videos are recomposited from original footage. Excavator marks retain their physical decal region and source ink brightness. Safety-helmet inserts follow short, source-checked motion segments and foreshortening. Vest marks use cloth visibility so hands remain in front of the print. Office vest and ID-card company text are included. Source dimensions, frame rate, frames and cuts are retained; pixels outside masks are identical before the necessary H264 export. The source-only verification record is `media-source-verification.json`. Previous files remain available for recovery. The existing abstract glass artwork is separate from photographed construction/robotics media and retains its generation provenance.

Do not return to full-frame generative photo edits. Preserve real photographed scenes and make future brand corrections only within verified source-brand masks.
