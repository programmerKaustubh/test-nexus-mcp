# Changelog

All notable changes to the TestNexus MCP Server will be documented in this file.

## [1.0.1] — 2026-04-23

### Security

- **[CRITICAL, CWE-522] Patched `X-API-Key` leak on cross-origin redirects.** Every outbound `fetch()` that carries the `X-API-Key` header now sets `redirect: "error"`. Node's `undici` strips `Authorization` and `Cookie` on cross-origin 3xx but preserves custom headers like `X-API-Key` — an attacker in a position to trigger a redirect (DNS poisoning, hosting misconfiguration) could capture the key. Refusing redirects closes the vector at the cost of breaking on any legitimate 3xx the backend starts issuing (the backend never should).
- **[MEDIUM, CWE-209] Broadened local-path redaction in error messages.** `sanitizeErrorMessage` previously stripped only `PROJECT_ROOT`; it now also strips the operator's home directory and falls back to regex redaction of Windows (`C:\Users\<name>`), Linux (`/home/<name>`), and macOS (`/Users/<name>`) user paths. Prevents the LLM and any downstream transcript store from learning the operator's local filesystem username.
- **[MEDIUM, CWE-209] Wrapped `validation.error` emissions in `sanitizeErrorMessage`.** `handlePushBuild` returns APK-validation errors directly to the tool response; `fs` errors from `listZipEntries` on an inaccessible path previously leaked absolute paths verbatim. Now passed through the sanitizer like every other returned error.

### Changed

- **BASE_URL dropped its base64 wrapping and migrated to `https://api.twocan.us`.** The previous base64-encoded raw Cloud Functions URL (`us-central1-test-nexus-prod.cloudfunctions.net`) is replaced with the branded Firebase Hosting endpoint that rewrites to the same backend. The branded URL is already public (DNS, website, privacy policy); obfuscating it in source added no security value and hid the code's intent. Public MCP users now hit the same endpoint the Android app has used since the branded-domain migration.

## [1.0.0] — 2026-04-13

### Added
- `push_build` tool — validate and upload APK builds to TestNexus
- `list_builds` tool — list recent builds with version, branch, and timestamp
- `download_build` tool — download a specific build with SHA-256 verification
- 6-layer APK validation (extension, size, magic bytes, structure, zip bomb, server re-check)
- Streaming SHA-256 computation (memory-safe for 150MB APKs)
- Git metadata extraction (branch, commit SHA, commit message)
- Path traversal protection via `assertWithinRoot()`
- Auto-Push hook for PostToolUse integration
- Claude Code plugin manifest for marketplace distribution
