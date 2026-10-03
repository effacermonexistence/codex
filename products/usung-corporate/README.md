# U-SUNG corporate website

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

`baseline/` preserves the HTML, stylesheet, and script retrieved from the company’s production site on 2026-10-03. `baseline/assets.json` records the original media hashes. Existing construction imagery retains the reference labels and source links from the original page; it is not used to claim new company projects. The corporate home uses full-frame construction video. The AI page uses acquired Contextual AI artwork with a Mistral-style typographic composition and keyboard-accessible capability tabs. Physical AI uses acquired Dexterity and Field AI footage. Runway and Luma are excluded by the owner. Reference media is labeled and linked to its source; third-party performance statistics and testimonials are not represented as U-SUNG results. Shared typography, cream/black surfaces and orange accents follow the original construction experience.

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

`references.json` records source pages, exact acquired asset URLs, original hashes, served hashes and media transformations. Originals are retained in the task research output. Videos preserve source footage and aspect ratio, are limited to up to 14 seconds and optimized for web playback. Posters are exact video frames. No AI-generated bitmap, video, or procedural sculpture is used. Diagram geometry is preserved while the source-company title is adapted to U-SUNG × OmarAGI.
