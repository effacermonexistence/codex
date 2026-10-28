# OS1 Voxel Workshop

Minecraft-inspired **procedural 3D presentation** for the existing OS1 session engine. Native entry remains `os1.rail.simulation` (시뮬레이션). `src/main.js` uses `VoxelScene`; existing native UUIDs, titles, send/stop/new methods, permissions, drafts, queues and provider sessions remain authoritative.

## Active visual architecture

`voxel-scene.js` and `voxel-world.js` build real Three.js block geometry: terrain, trees, water, mining lodge, ore banks and articulated humanoid miners with pickaxes. Terrain and worker parts are instanced; worker limbs, yaw and cargo follow the shared native-driven motion state. Canvas textures are generated locally for block surfaces, contact shadows and text labels. No active screenshot plane, SCV sprite sheet, remote texture, CDN, external font or network art loader is used.

Three.js is pinned to **0.180.0**, bundled locally by Vite, with `THREE-LICENSE.txt` retained. WebGL failure displays an explicit alert; it is not silently replaced with the earlier scene or fake activity. The viewport follows available native window space rather than a fixed screenshot ratio. This is a replacement design, not a pixel-identical restoration claim.

The **17 declared bundled files plus `manifest.json`** remain the established package inventory. Legacy `classic-reference.png`, classic sprite/terrain PNGs and provenance JSON files remain **unloaded historical/recovery assets**; their byte identities are checked, but they are not an active fallback. Their presence does not mean that classic graphics are rendered. Only the compiled entry JS/CSS and entry HTML change appearance.

## Session and result contract

- **One miner = one actual OS1 session UUID.** All admitted working and queued sessions remain on the field independently of six-row roster pages or search. Historical sessions stay accessible without flooding the initial world.
- **Working:** the authoritative native `working` state drives base → ore → mining → cargo return → repeat. Independent workers can run concurrently. Trips and limb motion are cosmetic activity, not measured progress or token consumption.
- **Idle, queued, failed and terminal:** motion and body pose freeze. Queued work is not represented as executing. A terminal result marker means a result awaits review, not that quality or success is certified.
- **Inspection and retirement:** the result must belong to the current request, selected UUID and exact revision. Its native status/partial/error/receipt boundary is retained. Displaying the result records inspection; the owner must then explicitly confirm it. Only the accepted native review receipt removes that miner from the world.
- **Retirement is not deletion.** It does not archive/delete the conversation, alter messages, purge queues or approve task quality. Bounded private `simulation-presentation.json` receipts are presentation state, not another session database. Inspection/review do not call draft-saving native selection.
- **Reassignment:** accepted work on the same UUID brings the same miner back without creating another session. Existing native draft, permission, execution and queue gates remain unchanged.

## Resources, unknowns and appearance

Only supplied native observations drive resource presentation. Valid complete RCC telemetry supplies **observed token use for the current request**, not lifetime conversation spend. Cached provider data may separately supply **remaining quota percentage**, source, freshness/retained-estimate basis and observation time. Percentages are never converted into absolute token balances. Published quota is account-scoped and filtered again after account/provider changes; account identifiers do not enter the WebKit payload.

Unmeasured or unusable balances stay unknown: neutral ore location markers and explicit `? 미측정`, never fabricated zero/full blue banks. Exact zero and exact full are distinct from any partial positive ratio. Partial ore retains at least one and at most eleven visual chunks; those chunks are an abstract ratio display, **not a token count**. Tiny or near-full percentages use `<0.1%` / `>99.9%` rather than rounding into false endpoints. Raw observations are not rounded or changed.

OS1 Settings → Appearance remains the single accent authority. Default OS1 Pink is `#EDB3CC`; native theme changes recolor shared building, hat and selection materials without replacing sessions, restarting work or changing motion phase.

## Preview and controls

**동작 미리보기 · 실제 작업/토큰 아님** identifies a separate synthetic 12-miner cohort. Pause, resume, finish/review and example-quota controls invoke no providers. Native controls are disabled and every native bridge dispatch is also blocked. Synthetic IDs, results and examples never enter native state. Mode changes clear visible instance cohorts without displaying preview miners as live work; native positions remain available when returning to **실제 세션으로**.

Click a miner to select it. Wheel zooms; right-drag orbits; Shift/middle-drag pans. The 1–9 hotbar exposes new miner, prompt, stop, result, focus, map, reassign, chat and menu. Native command modifiers are not stolen by game shortcuts. Provider-visible execution begins only through the existing native send path.

## Bounded rendering cost

The static world uses shared geometry, procedural textures and instanced terrain. Workforce body/shadow/marker parts use at most **30 instanced batches across three appearance classes**, rather than a separate draw-call rig per session; this is not a claim that the entire frame has only 30 draw calls. Larger workforces disable per-miner dynamic shadow casting while keeping all identities represented.

Pixel ratio is capped at 1.5. Sustained slow frame scheduling can lower it to 1.0 and reduce the shadow map from the high setting to 1024. Camera interpolation remains smooth. Hidden surfaces suspend rendering, and a visible but idle world with a settled camera does not continuously submit GPU frames. Resize, selection, theme and snapshot changes redraw on demand. Diagnostics report the renderer's observed FPS/draw calls and quality mode; these are separate from backend activity and token evidence.

## Verification and deployment boundary

From this folder:

```sh
node ../scripts/build-simulation-garden.mjs
node ../scripts/test-simulation-garden.mjs
node ../scripts/test-gameplay-contract.mjs
node ../scripts/test-voxel-scene.mjs
node ../scripts/test-terran-motion.mjs
node ../scripts/test-classic-theme.mjs
```

The last script keeps its historical filename for release callers; its active visual checks now cover native accent and voxel materials/viewport, not obsolete classic rendering. Source tests preserve the native origin/main-frame/UUID gates, current-result review boundary, account-scoped quota and exact artifact manifest. The nine maintained field/motion tests remain unchanged.

`test-gameplay-contract.mjs` executes actual main/field/motion code with an **explicit VoxelScene renderer test double**. `test-voxel-scene.mjs` executes the actual scene/world plus pinned Three CPU geometry and state with **DOM surfaces and the WebGL driver doubled**. They check lifecycle, pose freeze, parallel identities, resource boundaries, scene isolation, CPU raycast, rendering budgets, disposal and visible failure handling. Neither is real GPU pixel/FPS/cost, native UI or provider-run proof. Actual native rendering, installed artifact identity and preservation require separate receipts.

This task is a static presentation update against the installed 441 source baseline: no native engine field, RPC, session schema, permission or provider implementation is changed by these frontend files. Deployment belongs to the existing verified, queue-preserving installation path and must preserve the current native binaries, CLI/configuration, messages, queues and signer continuity. Source/build success alone is not an installation or user-adoption claim.
