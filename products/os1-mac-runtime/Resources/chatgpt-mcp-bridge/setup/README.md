# Human-only Tunnel key entry helper

`SecretEntry.swift` builds a dedicated native macOS utility, not an OS1 release.
The operator launches it only when the human is ready to paste a **newly created
OpenAI Tunnel control-plane key** from the official site. This is not an
inference-API client, and this helper performs no networking or login.

## Security and interaction contract

- A secure text field receives only manual user input/paste. The helper never
  reads the clipboard automatically. Native Edit → Paste is available.
- Only the explicit **Save on this Mac** button writes anything. Return has no
  save shortcut. Cancel/window-close clears the field and exits without saving.
- Production destination is fixed to the current POSIX user's home:
  `~/.os1/chatgpt-mcp-transport/control-plane.key`. No destination CLI flag exists.
- Storage is plaintext on this Mac, **not encryption**. `.os1` and the transport
  root must be owned by the current user, exactly mode 0700, without extended ACLs.
  New files are mode 0600. Existing unsafe paths are rejected, not chmod-repaired.
- All path components are opened relative to held descriptors with `O_NOFOLLOW`.
  Key creation uses `O_EXCL`, `O_NOFOLLOW`, file owner/type/link/mode/ACL checks,
  `fsync`, macOS `F_FULLFSYNC`, and directory synchronization.
- Existing key files, symlinks, hardlinks, and non-private files are never read or
  overwritten. No existing credential/cache is imported.
- The key must be sk-prefixed, 16–4096 printable ASCII characters without spaces.
  No silent trimming occurs. The field is cleared after save or error.
- No values or key hashes go to stdout, stderr, command arguments, or receipts.
  No claim is made that all Swift/AppKit memory copies are securely zeroized.
- A mode-0600 `secret-entry-receipt.json` contains only the key path, owner, mode,
  time, and `authentication_verified:false`. It does not prove a ChatGPT request
  happened. If receipt creation fails, the already durable key is preserved and
  the UI reports that exact partial state.

## Isolated validation

```sh
xcrun swiftc -parse-as-library -D SECRET_ENTRY_TEST SecretEntry.swift -o /PRIVATE_TEMP/secret-entry-tests
/PRIVATE_TEMP/secret-entry-tests
xcrun swiftc -parse-as-library -O -framework AppKit SecretEntry.swift -o /PRIVATE_TEMP/OS1MCPSetup
```

The test-only entry point creates a canonical temporary directory, uses a dummy
non-credential value, tests validation, permissions, exclusive creation,
symlink/hardlink/public-directory rejection, ACL rejection, synthetic wrong-owner
metadata, receipt redaction, and a no-save fixture. It removes only that temporary
fixture directory. It does **not** read/write the production key destination.

The no-save fixture is a filesystem-path test, not a claim of a live GUI cancel
test. Actual user paste/save, accessibility rendering, connector authentication,
and OS1–ChatGPT roundtrip remain separately verified stages. An ad-hoc code
signature is local integrity evidence, not Apple notarization or a security audit.

Do not launch this app automatically during tests or harvest a generated key with
browser automation. The human alone supplies the new key and clicks Save.
