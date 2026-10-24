# OS1 Session Garden

Native sidebar entry: `os1.rail.simulation` (시뮬레이션).

The native SessionStore is authoritative. Unit UUIDs and names are the existing conversation UUIDs and titles, not a second session store. Search/paging bounds rendering to 24 workers without renaming or dropping stored sessions. Working animation follows `isSessionRunning`; queued, failed and completed states are distinct. New, select, open, send and stop call the existing native methods. Existing composer drafts are protected from overwrite.

The garden is a local-only WKWebView with a nonpersistent data store, a main-frame + exact-file message gate, and `connect-src none`. It never launches another provider process. Closing the surface leaves conversations mounted and stops hidden GPU rendering.

Build assets:

```sh
cd products/os1-mac-runtime/SimulationGarden
npm ci
node ../scripts/build-simulation-garden.mjs
node ../scripts/test-simulation-garden.mjs
```

Generated assets and their SHA-256/byte manifest are included in the normal release payload. Three.js is MIT; original procedural scenery and worker geometry do not include StarCraft game assets.

Local feature installation preserves the installed build434 CLI and its permission/route/queue boundaries. It is not a publication of a new runtime release. Use the existing verified installer with `--preserve-queue`; never replay or replace live session data. A separate native render/interaction receipt is required in addition to source tests.

Repair methodology reference actually inspected: the abstract of Huang et al., *Large Language Models Cannot Self-Correct Reasoning Yet* (https://arxiv.org/abs/2310.01798). External compiler results, deterministic source/resource checks and actual native UI observations are the adoption evidence; self-review alone is not.
