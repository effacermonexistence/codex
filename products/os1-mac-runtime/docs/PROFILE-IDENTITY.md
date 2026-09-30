# OS-1 profile menu and local identity

The lower-left rail now has a settings gear and a profile avatar. The avatar opens
the account menu: profile, recorded usage, existing Governance monitor, connected
Codex/Claude accounts, settings, and OS-1 sign-out. Conversation views stay mounted
under the existing monitor; opening these surfaces does not submit work or mutate
conversation/queue state.

## Identity boundaries

- OS-1 identity is separate from macOS identity and Codex/Claude credentials.
- A fresh installation displays a guest profile, not the machine owner's name or
  the name from a connected CLI account. No paid plan is inferred.
- Google uses system-browser authorization code + PKCE S256, unpredictable state,
  exact callback validation, fixed Google token/userinfo endpoints, and a verified
  userinfo subject. The only scopes are `openid email profile`.
- Apple uses `ASAuthorizationAppleIDProvider`, bound request state, native
  authorization completion, and credential-state checks on restore. Apple's
  first-consent name/email are retained only for the same provider and subject.
- Only the OS-1 identity item is stored in the local, non-synchronizing Keychain.
  Tokens, codes, callbacks and raw authentication errors are not shown or logged.
- Restore verifies with the provider before presenting a signed-in profile.
  Cancellation invalidates late callbacks; storage failure cannot adopt a login.
- Sign-out clears only that OS-1 identity item. Existing local work and provider
  connections remain intact. This is explicitly stated in the account panel.

This client profile is **not a cloud authorization system or a multi-user data
boundary**. Current conversations, queues, files, backend connections, and usage
remain local to the macOS user, even when changing OS-1 profiles. Server-side
identity verification, tenancy, account-scoped storage, linking identities, cloud
sync, account deletion and subscription/billing are not implemented by this change.
Do not enable a shared-machine/multi-tenant product claim based on this UI.

## Required release registration (not configured in this checkout)

The UI remains usable in local mode. Both social providers fail closed until their
app registration is configured; buttons explain the unmet setup rather than
pretending sign-in succeeded. Do not copy another app's credentials.

### Google

Create an OAuth iOS-type client for the app's actual bundle ID, as Google's
iOS/macOS instructions specify. In `Resources/Info.plist`, set `GIDClientID` to the
public client ID and register its exact reversed client ID under
`CFBundleURLTypes` → `CFBundleURLSchemes`. The callback used by this client is
`<reversed-client-id>:/oauthredirect`. Register/configure that callback with the
provider. A client secret must never be embedded in the Mac app. Complete the
consent-screen/distribution requirements in the owning Google project.

### Apple

Enable Sign in with Apple for the actual App ID in the owner's Apple Developer
team, provision and sign the distributed app accordingly, and include the approved
`com.apple.developer.applesignin` entitlement with `Default`. Only then set
`OS1AppleSignInEnabled` to `true` in `Resources/Info.plist`. A flag does not supply
the entitlement, team registration, provisioning profile or valid signature.
None of those account/security settings was changed in this source task.

Before enabling for distribution, perform real sign-in, cancellation, restart,
revocation, account change, and sign-out tests on the signed build. Unit fixtures
do not establish successful live OAuth. When adding a cloud service, verify the
provider-issued identity on that service before granting any access; local profile
metadata is not a server authentication credential.

## Usage and verification

The usage pane groups this Mac's recorded task attempts by task start date over
seven calendar days. Retries and mixed-provider costs remain included. Cached
tokens are not double-counted. Missing metering, corrupt or omitted records are
identified; no subscription remainder or billing cost is invented.

New diagnostic entry points (no live sessions or backend calls):

```sh
.build/debug/OS1App --self-test-profile
.build/debug/OS1App --render-profile-preview artifacts/profile-menu/render
```

The preview uses synthetic profiles/usage and memory-only identity storage.
The profile regression suite is also part of the standard `--self-test` path,
so the existing release self-test runs it without requiring a new pipeline flag.
Fixtures cover PKCE, callback rejection, configuration gating, cancellation,
late success, failed storage, revocation, restoration, subject binding, Apple
first-consent metadata, and usage arithmetic. PNG rendering and pixel checks are
separate from live OAuth and installed-app verification.

References inspected for this change:

- [Google native-app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google iOS/macOS registration](https://developers.google.com/identity/sign-in/ios/start-integrating)
- [Apple native authentication](https://developer.apple.com/documentation/authenticationservices/implementing-user-authentication-with-sign-in-with-apple)
- [Apple sign-in entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.applesignin)
- [ReAct](https://arxiv.org/abs/2210.03629) and
  [intrinsic self-correction limits](https://arxiv.org/abs/2310.01798): inspected
  abstracts; used the external-feedback method (compiler, deterministic tests,
  native rendering), not model self-assurance as evidence of the change.
