# OS1 Terran Session Surface

Native entry: `os1.rail.simulation` (시뮬레이션). The native SessionStore remains authoritative. This replaces the earlier procedural garden presentation without replacing the native engine, conversations, routing, queues or permission policy.

## Locked visual reference

- Reference image: https://starcraft2.4fansites.de/screenshots/original/1509.jpg
- Gallery: https://starcraft2.4fansites.de/galerie_1_1013.html
- Source resolution: 1916 × 1075.
- `public/reference.json` records source and asset SHA-256 identities.

The full original image provides terrain, structures, portrait, interface chrome and command icons. Only five worker-removal masks use a generated clean plate. All other original pixels remain the original source. Dynamic SCVs are source-pixel silhouette sprites, not generic 3D substitutes. The command surfaces are transparent functional hit regions over the original HUD; mission entry is a game-styled popup.

Pixel claim boundary: the in-app F12 diagnostic compares six unchanged HUD-chrome rectangles (48,880 source-space pixels). A zero difference applies to those rectangles only. Session names, native status, dynamic workers, minimap worker dots and the five removal masks are intentional differences. The whole frame is not claimed pixel-identical.

## Runtime contract

Four actual OS1 UUIDs are visible at a time; the remaining sessions are searchable/paged. A unit's displayed name is the actual conversation title. No fictitious engine task is created for the animation. Session selection, opening chat, creation, prompt dispatch and interruption call the existing native methods.

`src/mining-state.js` holds the independently testable cosmetic state machine. Active means the native snapshot status is exactly `working`. Phase advances only while active and visible. Each cycle travels from command center to mineral, mines, carries a crystal back, and repeats. Native idle/queued/failed/completed state freezes the existing phase and position. Resuming the same UUID continues that phase rather than teleporting to base. The motion is an activity indicator, not a measured percentage of task completion.

The surface is a local-file WKWebView with nonpersistent website storage, an exact-file/main-frame command gate and `connect-src none`. It does not copy credentials or launch another provider process. Existing native composer drafts and per-session surface drafts are preserved.

## Build and verify

```sh
cd products/os1-mac-runtime/SimulationGarden
npm ci
node ../scripts/build-simulation-garden.mjs
node ../scripts/test-simulation-garden.mjs
node ../scripts/test-terran-motion.mjs
```

The asset helper keeps module-local lexical scope inside a classic-script IIFE, avoiding file-URL module CORS without granting universal file access. Generated resources have exact SHA-256/byte manifests and narrow release payload paths.

Local installation uses the existing verified installer and `--preserve-queue`, with the same signer and unchanged build434 runtime CLI. The old visual baseline remains in Git and binary recovery. This local UI update is not publication of a new global runtime release.

Synthetic browser diagnostics are kept outside the app/source payload and explicitly labeled `DIAGNOSTIC · NO MODEL CALLS`. Their results are not provider execution proof. Existing native routing remains separately governed and tested.
