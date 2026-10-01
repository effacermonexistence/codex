# IntentKit

Swift package with the `OS1Context` library and its small C helper module
`OS1System`.

## Build and test

```sh
swift build
swift build --product OS1ContextTests && .build/debug/OS1ContextTests
```

Command Line Tools-only Macs do not ship XCTest, so the regression suite is an
executable runner (`Tests/OS1ContextTests`) instead of an XCTest target. It
prints one summary line per fixture group and exits non-zero on the first
failing check.

If `swift build` runs inside an already-sandboxed shell and fails with
`sandbox_apply: Operation not permitted`, add `--disable-sandbox`.
