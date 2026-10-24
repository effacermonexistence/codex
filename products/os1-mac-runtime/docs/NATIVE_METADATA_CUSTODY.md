# Provider-owned native metadata custody

The installed431 own Codex attempt had an exact verified persistence path,
session and turn. Its119671-byte provider-created rollout was0644, owned by the
current UID, single-link and not writable by others. The terminal display
publisher used the private OS-1 sidecar reader (requires0600), so the source
was rejected before model/effort metadata parsing. Selected settings were
correctly NOT relabeled observed; the UI therefore retained unknown settings.

## Narrow policy split

`RCCNativeDisplayStore.read()` and `RCCNativeDisplayReceipts` remain unchanged:
OS-1 observation sidecars/receipts require owner-only custody. Only
`readNativeMetadata()` uses the separate provider-native metadata reader.

The native reader accepts owner-owned regular single-link0600/0644 logs that
are not group/world-writable, executable or special-bit files. It reads only
the exact canonical persistence path supplied by the already-verified native
transport. No provider file is chmodded, rewritten, copied into a credential
cache or granted additional authority. No directory/session/history discovery
or fallback path is introduced.

The reader uses descriptor-based O_NOFOLLOW/O_NONBLOCK reads, a16MB bound,
current UID/single-link/type/mode checks, pre/post file descriptor and named
file identities/mode/size/timestamps, and stable canonical parent descriptor
binding. A writable/foreign/aliased containing directory is rejected too.

Parsing remains separate: session/turn/time/output constraints, metadata
conflicts, exact source hash, current task/node/attempt/candidate/config,
receipt hash and graph bindings remain unchanged. A readable source is not a
quality certificate, execution permission, hidden-state claim or reason to
substitute selected/ACK settings for native observations. Missing/unsafe
metadata still yields unknown and never triggers a provider retry.

## Verification boundary

- OS1Context target build passed.
- Existing exact publisher/receipt/loader/projection fixture now exercises0644
  provider metadata while retaining0600 sidecar rejection:59checks PASS.
- `python3 scripts/test-native-metadata-custody.py` compiles exact source reader
  bodies in a temporary harness:18checks PASS. It tests0600/0644 positive;
  group/world-writable, executable, special, hardlink, symlink, directory and
  FIFO negatives. Foreign UID/oversize predicates use synthetic stat values;
  no chown privilege or false actual foreign-file-read claim is required.
- The compiled patched module read and parsed the exact own119671-byte native
  file, yielding native_turn_context/gpt-6-astra/ultra, source SHA
  fa3f8dfeee7bf0be77c77f9e1c5423d0d437e73c2f28384db3012a2db52d288f.
  No answer text or grader was inspected and no model/native/RPC was called.

This is source-level repair plus exact metadata/pure fixture verification,
not installation, a refreshed live UI, quality parity or quota-savings proof.
The old native file, original sidecar, receipt and task snapshot remain intact.
