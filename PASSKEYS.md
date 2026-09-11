# Passkeys

Inkstone supports up to ten passkeys per existing account. Register with a password first, then open **Settings → Account → Passkeys**. A passkey uses your device's biometric verification, PIN, or a compatible security key. Inkstone stores public keys, never private keys or biometric data.

## Enable on an instance

Set `PUBLIC_URL` as a runtime variable in the Cloudflare Worker dashboard under **Settings → Variables and Secrets**, or add it under `[vars]` in the deployment configuration you use (`wrangler.toml` or `wrangler.kv.toml`):

```toml
[vars]
APP_NAME = "Inkstone"
PUBLIC_URL = "https://notes.example.com"
```

Both deployment configurations set `keep_vars = true`, so subsequent Git-triggered deployments retain dashboard variables omitted from the configuration file. Variables explicitly declared in `[vars]` still take precedence over dashboard values. Configure `PUBLIC_URL` as a Worker runtime variable, not only as a build environment variable. If a previous deployment already deleted it, add it again once; the preservation setting cannot restore a deleted value.

Use the site's exact, permanent HTTPS origin, without a path, credentials, query or fragment. Missing or invalid configuration disables passkeys without disabling password login. The RP ID is the hostname (without the port); the allowed Origin includes the port when present. Requests must arrive at that origin. Other domain aliases cannot register or use passkeys. Local development can explicitly use `http://localhost:5173` (substitute the actual port).

Choose a permanent domain before enrollment. A workers.dev address and a custom domain have separate credentials. Changing the domain requires signing in with the password and registering new passkeys. Reusing a D1 database on another domain does not make its passkeys portable.

## Authentication and recovery

- Passkey registration and sign-in require authenticator user verification and request discoverable credentials. Attestation is not requested and no authenticator vendor is required.
- A verified passkey signs in independently, including when TOTP is enabled. Password sign-in still requires the configured TOTP factor or recovery code.
- Adding or deleting a passkey requires the current password plus a TOTP code or recovery code when TOTP is enabled. Recovery codes are consumed at reauthentication, even when subsequent registration is canceled.
- Successful additions and deletions revoke other sessions and invalidate the user's pending authorized management challenges. The current session is retained. Renaming only requires a current session.
- Deleting the last passkey is allowed because the password remains available. Deleting a server record does not remove the corresponding entry from the device or password manager.
- Passkeys cannot reset a forgotten password or replace the password required by existing sensitive settings. TOTP recovery codes do not replace the password. No passkey-only account registration or new recovery bypass is provided.
- Note exports and ordinary note backups do not contain passkeys. A full D1 backup contains public credential records, but it does not contain device private keys and does not remove domain restrictions. Restoring an old D1 backup can also restore previously deleted credential records; review them before reopening the instance.
- Demo mode and new offline authentication do not support passkeys. Existing offline notebook access follows the existing session-cache behavior.

Browsers often use the same `NotAllowedError` for cancel, timeout, and no suitable credential. Inkstone presents this as an incomplete operation, without claiming it knows which event occurred.

## Automated validation

Install the project dependencies with `npm ci` (Node 24), then run:

```sh
npm run typecheck
npm run test:unit
npm run i18n:check
npm run comments:check
npm run test:passkeys
npx playwright install chromium
npm run test:passkeys:browser
npm run deploy:check
npm run deploy:check:kv
npm run build:demo
```

`test:passkeys` bundles the actual Worker application and runs it in workerd through Miniflare, using ephemeral D1, R2/KV, and the real credential-vault Durable Object. Its software authenticator produces CBOR registration objects and real ES256 signatures. It covers protocol rejection, replay/concurrency, credential ownership, authorization changes, TOTP/recovery factors, schema upgrades, expiry, and throttling. It does not use a deployed instance or Cloudflare account.

`test:passkeys:browser` builds the production client, starts an isolated local Worker on port 7712, and uses Chromium CDP virtual authenticators. Keep that port free. Test state is discarded at shutdown. Screenshots and failure traces are saved under `test-results/` and are not committed. Browser profiles and synthetic passkeys used here contain no real credentials.

The existing HTTP E2E suite must also be run against a separate, empty local instance. Do not point the E2E runner at a real notebook.

## Release acceptance

Before releasing, run the following checks on an independent, fixed HTTPS test domain with disposable accounts. Virtual authenticators do not validate platform biometric prompts, synchronization, or physical security-key behavior.

| Environment | Required manual checks | Status for this implementation |
| --- | --- | --- |
| macOS Safari and Chrome | Platform enrollment, user verification, login, cancellation | Pending physical-device acceptance |
| iPhone Safari | Face ID / device PIN, repeated login, available synced passkeys | Pending physical-device acceptance |
| Android Chrome | Platform enrollment, user verification and login | Pending physical-device acceptance |
| External security key with user verification | PIN enrollment/login, removal and cancellation | Pending physical-device acceptance |

Also verify responsive account settings, password fallback, lost-device instructions, and domain-mismatch rejection on the HTTPS instance. Do not label the release as fully accepted until the real-device matrix passes.

Before production upgrade, back up D1. Migration 12 adds credential/challenge tables and indexes and leaves existing accounts and notes intact. Roll back application code without dropping the added tables. Diagnostics log the operation, HTTP method and outcome only; no password, recovery code, private key, or complete authenticator response is logged.

## Validation record (2026-09-11)

- TypeScript, all 74 Vitest tests, internationalization validation, and whitespace checks passed.
- All 28 reported Workers/D1 integration tests passed across R2 and KV configurations (including the two parent test cases).
- The Chromium end-to-end scenario passed, including multiple devices/accounts, TOTP policy, mobile-width management, missing user verification, browser binding, expired/deleted credentials, offline recovery and duplicate-click prevention.
- R2/KV deployment dry-runs and demo build passed. No production deployment was performed.
- The existing HTTP E2E suite reports 170 passed and 3 failed. Running the same suite against unmodified baseline `bd96b14` in the same runtime produces the same results: FTS tag filtering, concurrent folder-move status expectations, and chunked multipart size enforcement. These failures are outside the passkey change.
- The comment-policy check reports seven pre-existing violations involving editor comments, localization comments/allowlist, a CSS comment and a Vite comment. No new passkey comment violations were added.
- The physical-device and fixed-HTTPS-domain acceptance matrix above remains pending. The complete release gate has therefore not been met.
