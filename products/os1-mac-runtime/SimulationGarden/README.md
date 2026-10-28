# OS1 Terran — voxel style only

**StarCraft objects and layout stay fixed; Minecraft is a rendering style, not permission to replace them.** The active scene is SCV utility mechs, an industrial Terran Command Center, eight blue mineral crystal banks, flat grass/dirt and the original classic HUD. No human miners, lodge, village, island or wooden scenery belongs to this target. The superseded humanoid/lodge scene is not an accepted visual baseline or fallback.

Native entry remains `os1.rail.simulation`. `src/main.js` uses `VoxelScene`; existing OS1 UUIDs, names, send/stop/new paths, permissions, drafts, queues and provider sessions remain authoritative. This is a static presentation change against native build 441, not another engine or session database.

## Object and layout floor

- **SCV:** mechanical chassis, enclosed cockpit, plated legs, claw, drill arm/rotor, team panels and blue cargo. It is not a human avatar renamed SCV. Claude may use the original gold hovering **Probe** identity; unknown routing remains a pending SCV appearance rather than an asserted provider identity.
- **Command Center:** stacked octagonal industrial metal hull, raised control structure, silver loading ramp, segmented team paint and vents/pipes. Its ground anchor remains `BASE = (350,205)`.
- **Minerals:** all eight banks remain blue crystal clusters at the unchanged `MINERALS` coordinates. Provider observations may affect quantity/brightness, not replace blue crystals with purple rocks or another object class.
- **Ground:** flat grass/dirt. Block geometry/materials provide the style; a new island, village, trees or terrain composition must not replace the original battlefield.
- **Default projection:** the original `640×316` ground layout is locked by an orthographic camera and depth compensation. Actual Three CPU projection tests check the Command Center and all eight mineral anchors within one pixel. This is a ground-coordinate test, not a whole rendered-frame pixel-identity claim. Pan/zoom are explicit view changes; fit restores the reference view.

The source floor is independently tested through actual geometry parts, octagonal hull primitives, crystal vertex colors, flat ground and projected coordinates—not merely object labels. A style-only request must not silently change object identity, scope or criterion. The earlier substitution is covered by existing object-substitution/criterion-drift/enforcement rules; no new foundational primitive is introduced.

## Original HUD authority

The fixed `640×480` classic stage, bottom HUD, portrait, wireframe, minimap positions and command hotspots are restored from the native441 source baseline. Only the upper `640×316` battlefield is rendered in 3D.

The bundled original `classic-reference.png` is the HUD authority (SHA-256 `8a03f347f2d5f6536054249db4eaae09cd1c7c48cc21f0d686b7e2eadf88a71a`). `drawHUD` copies **only source rows 316–479** to the same destination rows; the source screenshot's upper battlefield is never painted behind the 3D view. The wireframe uses its original source rectangle and the accepted accent tint. Dynamic minimap/session text overlays are intentional, so the entire HUD/frame is not advertised as pixel-identical.

The 17 declared bundle files plus `manifest.json` retain the established package inventory. `classic-reference.png` is actively used for the HUD; sprite/terrain atlases and provenance JSON remain unused historical/recovery assets. They are not a flat-sprite battlefield fallback. Three.js is pinned locally to **0.180.0** with its license; 3D field geometry and small procedural textures need no CDN, external image/font or network loader. WebGL failure is an explicit alert, not a silently substituted theme.

## Sessions, results and resources

One worker is one actual native session UUID. All admitted working/queued sessions remain on the field regardless of six-row roster pagination/search. Native `working` alone advances base → minerals → drilling → cargo return. Terminal, stopped, failed and queued states freeze position, phase, cargo and mechanical pose; queued is not executing. Animation trips are not measured progress or token consumption.

A returned result retains the native current-request status/partial/error/receipt boundary. The selected UUID and exact revision must first be displayed, then explicitly confirmed through the existing native review gate. Only the accepted receipt retires the worker visually. This does not delete/archive the session, edit messages, purge queues or certify quality. Inspection/review do not enter draft-saving native selection. Accepted reassignment on the same UUID restores the same worker without duplicating the session. Presentation receipts remain bounded/private `simulation-presentation.json` state.

Validated RCC telemetry is observed usage for the current request, not lifetime spend. Account-scoped provider quota percentages remain separate from absolute token quantities. Account/provider scope is rechecked after asynchronous reads and before snapshot publication; account identifiers do not enter WebKit data. Missing/unusable balances stay explicitly unknown with dim blue markers and `? 미측정`, not fabricated zero/full quantities. Exact0/100 endpoints remain distinct from partial ratios; tiny/near-full labels use `<0.1%`/`>99.9%`, without altering raw values. Visual chunks are ratio markers, not a token count.

OS1 Settings → Appearance is the single accent authority (`#EDB3CC` default pink). Building/team panels, selection and accepted wireframe tint share it; recoloring does not recreate sessions or change routing/state.

## Preview, controls and rendering cost

The prominently labeled model-free 12-worker preview is a separate synthetic cohort. Pause/resume/finish/review/example quota controls make no provider calls; native bridge dispatch is hard-blocked. Synthetic IDs/results never enter native state. Mode changes clear visible instance cohorts without blending preview objects into live work; returning to actual sessions preserves their positions.

The original command hotspots and minimap remain in place. Click a worker/list row, use G/Enter for a prompt, S stop, N new session, F9 roster, F10 menu, F11 result and F12 diagnostics. Wheel zooms and right/middle/Shift-drag pans the reference battlefield. Native command modifiers are not stolen.

Geometry/materials are shared and worker parts are instanced; tests retain 300 distinct worker identities with bounded mechanical batches rather than dropping parallel units. DPR is capped at 1.5, with a 1.0 / 1024-shadow balanced mode after sustained slow scheduling. Large workforces reduce dynamic shadow cost. Hidden views suspend rendering; a visible idle field with a settled camera does not submit perpetual GPU frames. These are implementation bounds, not a promise of measured FPS on every device.

## Verification and deployment boundary

Run from this folder:

```sh
node ../scripts/test-simulation-garden.mjs
node ../scripts/test-gameplay-contract.mjs
node ../scripts/test-voxel-scene.mjs
node ../scripts/test-terran-motion.mjs
node ../scripts/test-classic-theme.mjs
```

Source/security tests retain 17 strict native/origin/result/account-scope/artifact gates. Main lifecycle tests use an explicit renderer facade double. The actual-class CPU tests execute real SCV/Probe/Command Center/crystal geometry and Three projection/state with DOM/HUD-raster/WebGL-driver doubles. Source HUD SHA/crop verification is **not output-pixel proof**. Actual GPU/browser/native UI and installed data preservation require separate operator receipts. Earlier human/lodge assertions were the wrong target and are not accepted evidence for this scene.

Native source, CLI, configuration, capabilities, provider behavior and stored session/queue objects are outside this frontend change. Deployment belongs to the verified queue-preserving installation path, with current baseline and signer checks. Code-signature renewal may change signed executable bytes; unchanged native payload must be verified separately rather than described as whole-file byte identity. Source/tests/staging alone do not prove installation or visual adoption. Publication of the superseded Minecraft-world concept is postponed; only the corrected object may proceed through its own adoption gate.
