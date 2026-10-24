# OS1 Classic Terran Session Surface

Native entry: `os1.rail.simulation` (시뮬레이션). Existing native UUIDs, titles, send/stop/new methods, permissions, queues and provider sessions remain authoritative. This changes presentation, not the execution engine.

## Classic reference

The stage now uses StarCraft 1 / Brood War classic graphics at 640×480, not SC2 or a generated 3D substitute. Source screenshot: https://satirist.org/pix/starcraft/blog/2019-03-27_scv.png . Source article: https://satirist.org/ai/starcraft/blog/archives/784-produce-workers-closer-to-the-minerals.html . Official visual cross-reference: https://classic.battle.net/scc/terran/basic.shtml . The original image supplies terrain, Command Center, SCV silhouette, portrait, wireframe and command grid. Worker-removal masks clone source terrain with feathered edges. Faction paint, selection rings, wireframe and small chevron trim use the selected accent. Nearest-neighbor scaling preserves the low-resolution character. The whole themed frame is intentionally not pixel-identical to the source.

## One appearance authority

Settings → Appearance → Accent color offers eight swatches and a custom native color picker. OS1 Pink is the existing native `.93, .70, .80` color, represented as `#EDB3CC`. This is not asserted to be a copied Codex pink. Codex's documented appearance workflow supplies the settings interaction reference: https://learn.chatgpt.com/docs/reference/settings . Direct CUA inspection of the Codex app was unavailable; no permissions were broadened or restriction bypassed.

The optional `accentColor` field lives in the existing private OS1 settings file. Older files load pink without a migration write. Only six-digit hex colors cross the trusted native snapshot bridge. `accentHex` is part of snapshot deduplication. A color change redraws existing workers; it does not recreate sessions, reset phase, dispatch work, change routing, or overwrite drafts. Theme controls open the actual OS1 Settings sheet. The UI does not store a second preferences/session database.

## Motion contract

Four native UUIDs are visible at once; the rest remain searchable/paged. Active `working` state alone advances the phase: Command Center → minerals → mining dwell → cargo return → repeat. Idle, queue, failure and terminal state freeze exact phase/position/cargo. The same UUID resumes its phase. Hidden rendering is suspended. Animation is an activity indicator, not measured progress.

The local-file WKWebView remains nonpersistent, exact-file/main-frame gated and `connect-src none`. Native command modifiers are excluded from game hotkeys. Changing theme does not grant tool permissions or launch a provider call.

## Verification

Run `node ../scripts/build-simulation-garden.mjs`, `node ../scripts/test-simulation-garden.mjs`, `node ../scripts/test-terran-motion.mjs`, and `node ../scripts/test-classic-theme.mjs` from this folder. Native settings fixtures: `OS1ContextTests --appearance-only`. Browser fixtures stay outside the app payload and visibly say DIAGNOSTIC / NO MODEL CALLS; they are not provider-run evidence. The earlier native two-turn Codex test remains historical engine evidence, not a new inference run for this appearance-only update.

Repair method: inspected the abstract of https://arxiv.org/abs/2310.01798 (intrinsic self-correction limits). Adopt only after deterministic regression, actual rendered observation, and native settings/restart readback, rather than fluent self-review. No private source or log was sent in a research query.

Local installation uses the existing verified, queue-preserving installer with private paging snapshot/restore drill, unchanged runtime CLI/config and signer continuity. Historical SC2 resources remain recoverable through Git and the previous verified app recovery point.
