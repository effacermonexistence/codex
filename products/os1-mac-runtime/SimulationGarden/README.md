# OS1 Classic Terran Session Surface

Native entry: `os1.rail.simulation` (시뮬레이션). Existing native UUIDs, titles, send/stop/new methods, permissions, queues and provider sessions remain authoritative. This changes presentation, not the execution engine.

## Classic reference

The stage uses StarCraft 1 / Brood War classic graphics at 640×480, not SC2 or a generated 3D substitute. Source screenshot: https://satirist.org/pix/starcraft/blog/2019-03-27_scv.png . Source article: https://satirist.org/ai/starcraft/blog/archives/784-produce-workers-closer-to-the-minerals.html . Official visual cross-reference: https://classic.battle.net/scc/terran/basic.shtml . The original image supplies the Command Center, HUD, portrait, wireframe and command grid. Current terrain is an atlas of 23 decoded jungle megatiles (CV5 groups 8/9); workers and minerals use decoded source GRP atlases. `classic-sprites.json` and `classic-terrain.json` record pinned source identities and asset hashes. SCVs have 17 half-circle directions, mirrored west-facing poses, and three animation poses; Claude workers use the Probe atlas. This is an OS1 activity visualization, not a complete RTS engine. Nearest-neighbor scaling preserves the low-resolution character. The whole themed frame is intentionally not pixel-identical to the source.

Faction and wireframe paint use CSS-filtered canvas layers; team-color sprite atlases use a canvas multiply/mask pass. These do not depend on unsupported `CanvasRenderingContext2D.filter`. Selection rings and HUD emphasis use the same native accent.

## One appearance authority

Settings → Appearance → Accent color offers eight swatches and a custom native color picker. OS1 Pink is the existing native `.93, .70, .80` color, represented as `#EDB3CC`. This is not asserted to be a copied Codex pink. Codex's documented appearance workflow supplies the settings interaction reference: https://learn.chatgpt.com/docs/reference/settings . Direct CUA inspection of the Codex app was unavailable; no permissions were broadened or restriction bypassed.

The optional `accentColor` field lives in the existing private OS1 settings file. Older files load pink without a migration write. Only six-digit hex colors cross the trusted native snapshot bridge. `accentHex` is part of snapshot deduplication. A color change redraws existing workers; it does not recreate sessions, reset phase, dispatch work, change routing, or overwrite drafts. Theme controls open the actual OS1 Settings sheet. The UI does not store a second preferences/session database.

## Live gameplay contract

- **One worker = one actual native OS1 session UUID.** Running and queued sessions are admitted independently of roster search or pagination. The roster shows six rows per page; that is not a four- or six-worker battlefield cap. Historical conversations remain available through the all-sessions roster without flooding the initial field.
- **Running:** authoritative native `working` state drives repeated base → minerals → drilling → cargo return. Direction/pose frames and local separation make parallel workers independently visible. Mining trips are cosmetic activity indicators, not progress or token measurements.
- **Stopped/returned/failed/queued:** movement and mining stop at the current position; queued work is not shown as executing. Returned output and errors remain inspectable. A result belongs to the current user request and exact result revision, not an older answer in that session.
- **Review and retirement:** opening a matching result first records inspection; the owner must then press the explicit result-confirmation button. Only an accepted native review receipt retires that worker from the field. This never deletes or archives the conversation, edits its messages, purges a queue, or certifies that the task succeeded. Presentation receipts live in a separate bounded private `simulation-presentation.json`, not a replacement session database.
- **Same-session reuse:** a new accepted assignment on the same UUID brings the same worker back. Selection alone does not erase a review receipt. Existing native send, stop, permissions, draft-preservation and queue paths stay authoritative.
- **Hidden view:** expensive painting and movement suspend while the native surface or document is hidden; resuming does not accumulate a hidden-time movement jump.

## Tokens and minerals

Only measured native data is displayed. A complete validated RCC resource receipt supplies the current request's **observed token use**, not a lifetime session sum. A cached provider observation may separately supply a **remaining quota percentage** with its source, freshness/retained-estimate basis and observation time. A quota percentage is not converted into an absolute token balance. Codex and Claude mineral banks use their own supplied provider observations.

Missing, partial, expired, account-mismatched or otherwise unusable observations remain unknown. Unknown banks are dim location markers explicitly labeled `? 미측정`, not apparently full blue balances; unknown HUD values are not fabricated zeroes. A genuinely supplied remaining token count/capacity can drive a depletion ratio. Animation cycles never increment usage or manufacture a balance.

## Model-free preview

The visible **동작 미리보기 · 실제 작업/토큰 아님** banner identifies a separate synthetic 12-worker cohort. Its pause, same-worker resume, finish/review and example-quota controls allow motion inspection without provider calls. Every native dispatch is blocked in preview mode; synthetic workers, results and sample percentages never enter the native snapshot or session store. Entering/exiting preview clears cross-cohort departure fades, preserving native worker positions without briefly displaying synthetic units as live work. Return with **실제 세션으로**.

The local-file WKWebView remains nonpersistent, exact-file/main-frame gated and `connect-src none`. Native command modifiers are excluded from game hotkeys. Changing theme does not grant tool permissions or launch a provider call.

## Verification

Run `node ../scripts/build-simulation-garden.mjs`, `node ../scripts/test-simulation-garden.mjs`, `node ../scripts/test-terran-motion.mjs`, and `node ../scripts/test-classic-theme.mjs` from this folder. The source/integrity check invokes the portable isolated frontend contract in `../scripts/test-gameplay-contract.mjs`; it can also run directly, with optional `--output /absolute/receipt.json`. Motion testing invokes the maintained `tests/workshop-state.test.mjs` state-machine tests, not the removed fixed-duration interpolation model. Native settings fixtures: `OS1ContextTests --appearance-only`.

The isolated frontend harness executes actual control-flow modules with synthetic native snapshots and DOM/Canvas API doubles. It verifies admission, movement state, exact result binding, explicit retirement, hidden-view handling, resource draw calls and preview isolation; it is **not pixel/browser/native-provider proof**. Test/source hashes identify the checked artifacts. Actual native screen observation, current installed artifact identity and queue/message preservation still require separate receipts. The earlier native two-turn Codex test remains historical engine evidence, not a new provider run for these changes.

Repair method: inspected the abstract of https://arxiv.org/abs/2310.01798 (intrinsic self-correction limits). Adopt only after deterministic regression, actual rendered observation, and native settings/restart readback, rather than fluent self-review. No private source or log was sent in a research query.

Local installation must use the existing verified, queue-preserving installer and private paging snapshot/restore drill with explicit runtime/config/signer identity checks. If another verified native release has become active, preserve that newer baseline and rebuild the presentation changes against it; do not overwrite it with an older compiled app. A successful source test or build does not establish installation. Historical SC2 resources remain recoverable through Git and the previous verified app recovery point.
