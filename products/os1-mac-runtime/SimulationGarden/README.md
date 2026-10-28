# OS1 Terran — complete voxel interface

The accepted StarCraft world stays fixed: **SCV utility mechs, optional gold Probes, industrial octagonal Command Center, eight blue crystal banks, flat ground and the original default projection**. Minecraft changes the rendering/interface style, not those objects or native execution semantics. Human miners, lodge/village/island scenery remain the rejected target.

This revision extends the approved voxel style to **the entire simulation interface**, including the lower control deck, unit/operator portraits, nine commands, minimap, overlays, session drawer, dialogs, inputs, button states, tooltips and 3D nameplates. The prior requirement to display the original classic HUD image is explicitly superseded by this user-requested skin change. Original bitmap chrome is no longer active.

Native entry remains `os1.rail.simulation`. The simulation is a static presentation update against native build441: existing UUIDs, titles, providers, permissions, drafts, queue, send/stop/new and exact-result review gates remain authoritative. It is not a second engine or session database.

## World and object floor

The accepted `3cb6256…` world geometry/mechanics are preserved byte-for-byte outside the explicitly permitted `textBillboard()` UI texture function. Its sprite sizes/coordinates remain unchanged; its raster/material becomes nearest-filtered stone bevel. Actual Three CPU tests also retain mechanical SCV chassis/cockpit/claw/drill features, legless Probe structure, octagonal metal hull/control box/ramp, blue crystal vertex colors and flat ground.

Default ground projection remains `640×316`. Command Center anchor `(350,205)` and all eight `MINERALS` coordinates are checked against the actual orthographic camera within one pixel. Pan/zoom are explicit view changes; fit restores the reference. Projection accuracy is not a whole rendered-frame pixel-identity claim.

## Complete procedural HUD

`voxel-hud.js` creates the entire lower `640×164` band at `y316–479` using pixel/block Canvas primitives. It paints opaque backing throughout that band; the upper world remains transparent in the HUD layer. There is **no active Image, PNG/sprite loader, `drawImage`, external font/image request or old classic raster underneath**.

- Procedural SCV unit silhouette plus helmeted operator portrait.
- Selected Claude/Probe changes both to the gold Probe/optic variant; it is not merely a relabeled SCV.
- Nine distinct command glyphs retain their existing IDs, meanings and hotspot rectangles: move/prompt, stop, focus, reassign, gather, map, new session, chat and help.
- The minimap is procedural and uses the actual base, mineral and current worker coordinates plus viewport outline.
- Portraits display identity/state, not invented HP, progress, token counters or quality certification.
- HUD redraw is memoized by authoritative selection/engine/status/accent/mode. Active frames update the minimap, not the entire control deck.

The established package inventory remains **17 declared files plus `manifest.json`**. All classic reference/sprite/terrain PNGs and provenance JSON remain hash-verified historical/recovery assets but are **unloaded**. Three.js stays locally pinned to0.180.0 with its license. The active world and interface need no CDN, remote texture, image or stylesheet. WebGL failure is explicit; it does not silently substitute another theme or fake activity.

## All-UI coverage matrix

| Surface | Implementation/verification |
|---|---|
| Lower deck | Actual Canvas call trace covers all640×164 backing pixels opaquely; zero bitmap draws/loads |
| SCV/Probe and operator | Different procedural rectangle/color patterns, not text-only variant claims |
| Commands | Nine distinct pixel glyph traces at real hotspot rectangles |
| Minimap | Actual coordinate-driven base, eight banks, current workers and viewport calls |
| Session/resource/selection/empty/preview panels | All ten static panels use the block-panel skin |
| Prompt/result/menu/help dialogs | All four modal panels use the same block treatment |
| Buttons | All37 static buttons and dynamically emitted session rows use block-button styling |
| Interaction states | Normal, hover, pressed, focus-visible and disabled styles; hotspot overrides included |
| Text/select controls | Search, prompt and preview quota selector include block inset/focus/disabled styling |
| Tooltips | Procedural-style plain-text tooltip, no HTML injection or native action path |
| 3D labels | Actual local Canvas stone-bevel/nearest-filter textures; world footprint unchanged |

All76 accepted static IDs remain, plus one UI-only tooltip ID. Styling does not add a new native action. OS1 Settings → Appearance remains the sole accent authority (`#EDB3CC` default pink); materials, block panels and selection follow it without changing session identity or phase. Native OS1 settings/rail outside the simulation are not restyled by this DOM skin.

## Session/result and resource semantics

One worker represents one actual native session UUID. Running/queued workers remain on the field independently of roster pages/search. Only authoritative `working` advances base → minerals → drilling → cargo return; terminal, stopped, failed and queued states freeze position, phase, cargo and mechanical pose. Queued is not executing. The same UUID can resume without another session.

Current-request assistant/status/partial/error/receipt boundaries remain together. The selected UUID and exact revision must be displayed, then explicitly confirmed. Only accepted native review retires a worker visually. This never deletes/archives a conversation, modifies messages, purges a queue or certifies task success. Inspection/review do not enter draft-saving native selection. Presentation receipts stay bounded/private.

Measured RCC usage is current-request observed tokens, not lifetime spend. Provider quota percentages remain distinct from absolute balances and are filtered by current account/provider scope after asynchronous reads and before snapshots. No account identifier enters WebKit. Unknown stays visibly unknown; dim blue crystal markers and `?` do not claim a full balance. Exact zero/full remain distinct from every partial value. Tiny/near-full formatting uses `<0.1%`/`>99.9%` without rounding raw observations into false endpoints. Visual chunks and mining trips do not mint tokens or measured progress.

## Preview, controls and cost

The clearly labeled model-free12-worker preview is a separate synthetic cohort. Native bridge dispatch is hard-blocked; no preview ID/result/example quota enters native state. Pause/resume/finish/review demonstrate the interface without provider calls. Returning to actual sessions retains their positions.

Existing controls remain: click a worker or session; G/Enter prompt, S stop, N new session, F9 roster, F10 menu, F11 result, F12 diagnostics. Wheel zooms and right/middle/Shift-drag pans. Native command modifiers are not intercepted.

Geometry/materials are shared and worker parts instanced;300 distinct IDs remain represented. DPR is capped at1.5 with a1.0/1024-shadow balanced mode after sustained slow scheduling. Hidden views suspend rendering; a visible idle field with a settled camera does not submit perpetual GPU frames. These are code bounds, not measured FPS guarantees.

## Verification and deployment boundary

```sh
node ../scripts/test-simulation-garden.mjs
node ../scripts/test-gameplay-contract.mjs
node ../scripts/test-voxel-scene.mjs
node ../scripts/test-terran-motion.mjs
node ../scripts/test-classic-theme.mjs
```

The historical final script name remains for release callers, but now checks native theme/origin gates and the complete block-UI markup/scoped CSS matrix.17 strict source/security gates,22 main lifecycle cases and nine maintained motion cases remain. Actual geometry/HUD tests execute Three CPU state/projection and procedural Canvas calls with DOM/raster/WebGL-driver doubles. Opacity/glyph/source-call coverage is **not screenshot/GPU output proof**; DOM class/CSS coverage is not computed-browser pixel evidence. Root-owned real browser/native rendering and installed artifact/data preservation require separate receipts.

No native engine source, CLI/configuration, provider permissions or stored conversation/queue objects are changed by this skin. Deployment uses the existing verified, queue-preserving path. Re-signing may change embedded signature bytes; unchanged native payload must be checked separately rather than described as whole signed-file byte identity. Source/tests/staging alone do not establish installation, publication or owner visual adoption.
