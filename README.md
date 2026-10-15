<p align="center">
  <a href="https://twocan.us"><img src="https://raw.githubusercontent.com/programmerKaustubh/test-nexus-mcp/main/assets/mcp-hero.png" alt="Test Nexus MCP — your AI builds the APK, your team installs it" width="900"></a>
</p>

<h1 align="center">Test Nexus MCP</h1>

<p align="center">
  <strong>Ship Android builds to your testers' phones — straight from Claude.</strong><br>
  No USB cables, no emailing APKs, no manual file transfers.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@twocan/testnexus-mcp"><img src="https://img.shields.io/npm/v/@twocan/testnexus-mcp?color=00C7AF&label=npm" alt="npm version"></a>
  <img src="https://img.shields.io/node/v/@twocan/testnexus-mcp?color=00C7AF" alt="node >=20">
  <img src="https://img.shields.io/npm/l/@twocan/testnexus-mcp?color=00C7AF" alt="Apache-2.0">
  <img src="https://img.shields.io/badge/provenance-signed-00C7AF" alt="npm provenance">
  <a href="https://modelcontextprotocol.io/"><img src="https://img.shields.io/badge/MCP-server-6E56CF" alt="Model Context Protocol"></a>
</p>

---

```
"Build the app in debug mode and push it to my phone"
```

Claude builds your APK, validates it, verifies its signature, and delivers it to **every team member's phone** via push notification — they download and install it. It's the fastest loop between *"fix the bug"* and *"it's on the testers' devices."*

---

## Why you'd want this

| Without it | With Test Nexus MCP |
|---|---|
| Build → find the APK → email/Slack/USB it → tester side-loads it | Say *"push it to my phone"* — it's there in seconds |
| "Which build is this again?" | Every build carries its **branch + commit + message** |
| "Is this the file you actually built?" | **SHA-256** verified end-to-end + **signature-checked** on device |
| Sharing APKs in chat = uncontrolled distribution | Delivered only to your project's members, over HTTPS |

It turns a Claude Code session into a full **code → build → deliver** loop: *"Fix the login crash, build it, and push it to the team"* — and Claude does all three.

---

## What it gives Claude

Test Nexus MCP is a [Model Context Protocol](https://modelcontextprotocol.io/) server exposing **three tools**:

| Tool | What it does |
|------|-------------|
| `push_build` | Validates your APK (6 checks), computes SHA-256, extracts git metadata, and uploads it to your Test Nexus project. Every member gets a push notification, then downloads and installs it. |
| `list_builds` | Lists recent builds for your project — id, version, branch + commit, upload time, size. Read-only. |
| `download_build` | Pulls a specific build back to your machine by id, and **re-verifies SHA-256** after download. |

### Tool parameters

Claude infers these from your prompt, but you can pass any of them explicitly — e.g. *"push_build with version 2.1.0 and notes 'fixes boot crash'"* — to override the defaults.

**`push_build`** — auto-detects the most recent APK, reads the version from its manifest, uploads with no notes unless you override:

| Parameter | Type | Default | Controls |
|---|---|---|---|
| `apk_path` | string | auto-detected from Gradle output | A specific `.apk` to push — use it when you have multiple build flavors (e.g. `app/build/outputs/apk/qa/release/app-qa-release.apk`). |
| `version_name` | string | extracted from the APK manifest | Override the version label shown to recipients (e.g. `1.4.2-hotfix`). Usually let it auto-extract. |
| `notes` | string | empty | Free-form text shown alongside the build — a changelog summary or a "what to test" list. |

**`list_builds`** *(read-only — safe to call any time)* — returns the 10 most recent builds across all branches:

| Parameter | Type | Default | Controls |
|---|---|---|---|
| `limit` | number | `10` (max `50`) | How many builds to return. Lower = faster, less context noise. |
| `branch` | string | all branches | Restrict to one git branch (e.g. only `develop` builds). |

**`download_build`** — saves to `./<build_id>.apk` and re-verifies SHA-256 (partial file removed on mismatch):

| Parameter | Type | Default | Controls |
|---|---|---|---|
| `build_id` | string (**required**) | — | The build to fetch — get it from a prior `list_builds` call. |
| `output_path` | string | `./<build_id>.apk` | Where to save it (e.g. `~/Downloads/ourapp-2.1.0-qa.apk`). |

### The full flow

```
You (in Claude Code)          Cloud                     Phone
        │                       │                         │
  "build and push"              │                         │
        │                       │                         │
  Claude runs gradlew           │                         │
  push_build fires ───────► receiveBuild ──► signed URL   │
  APK validated locally         │                         │
  SHA-256 computed              │      APK → Firebase      │
  Uploaded over HTTPS ──────────┼──────► Storage          │
  finalize ─────────────────► SHA verified ─► FCM push ─► Test Nexus app
        │                    signature pinned      │       buzzes
  "Build pushed.                │                   │         │
   3 members notified."         │                   └─────► Tap to install
                                                            (SHA re-verified)
```

### Validated before anything uploads

1. File exists and ends in `.apk`
2. File is not empty
3. File is **under 300 MB**
4. ZIP magic bytes (`PK\x03\x04`) are correct
5. Contains `AndroidManifest.xml` and `classes*.dex`
6. Contains `META-INF/` (signed)

If any check fails, Claude tells you exactly what's wrong. **Nothing gets uploaded.**

---

<p align="center">
  <img src="https://raw.githubusercontent.com/programmerKaustubh/test-nexus-mcp/main/assets/mcp-how-it-works.png" alt="How it works: ask your assistant, push_build uploads it over HTTPS with a SHA-256 hash, your team installs it" width="900">
</p>

## Quick start

```bash
# 1. Install (one command — no clone, auto-updates)
claude mcp add testnexus -- npx -y @twocan/testnexus-mcp

# 2. Set your API key (from the Test Nexus app — see below)
export TESTNEXUS_API_KEY="ri_your_key_here"

# 3. In Claude Code, just say:
#    "build the app and push it to my phone"
```

> **Only official package:** `@twocan/testnexus-mcp`. It's published from CI with
> [npm provenance](https://docs.npmjs.com/generating-provenance-statements) — npm shows a verified
> link back to the exact public commit it was built from. Anything else is not ours.

---

## Let Claude install it for you

New to MCP servers? You don't have to run any commands yourself. Paste this to **Claude Code** (or any MCP-capable assistant) and it handles the setup:

```
Install the Test Nexus MCP server from npm (@twocan/testnexus-mcp).
Add it to my Claude Code config as "testnexus", then walk me through
setting my TESTNEXUS_API_KEY — I'll paste my ri_ key.
```

Claude reads this page, runs `claude mcp add testnexus -- npx -y @twocan/testnexus-mcp`, and guides you through the only two steps that need a human:

1. **Pasting your API key** — a secret only you have (from the app). No assistant can guess it, and you should never put it in a shared prompt or a committed file.
2. **Restarting Claude Code** — a newly-added MCP server loads on the next launch (or `/mcp`), after which the three tools are available.

That's it — from a single link to a working *"build and push it to my phone"* loop.

---

## Prerequisites

1. **Node.js 20+** — check with `node --version`
2. **The Test Nexus Android app** on your phone — [Get it on Google Play](https://play.google.com/store/apps/details?id=us.twocan.testnexus)
3. **A Test Nexus project** — in the app: **App Hub → Remote Install → +**
4. **Your API key** — shown once on the project screen when you create it (starts with `ri_`)

> The MCP needs **only** your API key. The backend URL is built in — there's nothing else to configure.

### Getting your API key

1. Open **Test Nexus** on your phone
2. Go to **App Hub → Remote Install**
3. Tap **+** to create a project (or open an existing one)
4. Copy the **API Key** (`ri_…`) — it's shown **once** at creation; you can rotate it anytime from the project screen

Store it like any other secret (see [Handling secrets](#handling-secrets)).

---

<p align="center">
  <img src="https://raw.githubusercontent.com/programmerKaustubh/test-nexus-mcp/main/assets/mcp-connect.png" alt="Connect your MCP client in 3 steps: create a project, set TESTNEXUS_API_KEY to your ri_ key, add it to your MCP client" width="900">
</p>

## Installation

### Option A — npm *(recommended)*

```bash
claude mcp add testnexus -- npx -y @twocan/testnexus-mcp
```

Then set `TESTNEXUS_API_KEY` in your shell profile (`~/.bashrc`, `~/.zshrc`, …) and restart your terminal.

**Verify:** run `claude`, then ask *"what TestNexus tools do you have?"* — Claude should mention `push_build`, `list_builds`, and `download_build`.

> **PowerShell note:** PowerShell strips the `--` separator, which breaks `mcp add`. Use the stop-parsing token: `claude mcp add testnexus -s user --% -e TESTNEXUS_API_KEY=ri_… -- npx -y @twocan/testnexus-mcp`.

### Option B — from source *(pin a commit / contribute)*

```bash
git clone https://github.com/programmerKaustubh/test-nexus-mcp.git
cd test-nexus-mcp && npm install
claude mcp add testnexus -- node src/index.js
```

### Option C — Claude Code desktop app

**Settings → MCP Servers → Add Server** →
- **Name:** `testnexus` · **Transport:** `stdio` · **Command:** `npx` · **Args:** `-y @twocan/testnexus-mcp`
- **Env:** `TESTNEXUS_API_KEY` = your key

Restart the app; the tools appear in the Claude panel.

### Option D — Claude Code web / IDE extensions (`.mcp.json`)

Add an `.mcp.json` to your project root (VS Code, JetBrains, and claude.ai/code all read it):

```json
{
  "mcpServers": {
    "testnexus": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@twocan/testnexus-mcp"],
      "env": { "TESTNEXUS_API_KEY": "${TESTNEXUS_API_KEY}" }
    }
  }
}
```

Committing this is safe — it references the env var, **not** the key value. Set `TESTNEXUS_API_KEY` in your environment/secrets.

### Option E — Claude Code plugin *(guided key prompt)*

This package is **plugin-ready**: it ships a [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json) that declares your API key as a **sensitive `userConfig` field**. When Test Nexus is installed as a Claude Code *plugin*, Claude Code **prompts for the key in its own UI** and stores it in the OS keychain — you never export an env var or paste the key into a file. It's the smoothest, most secure setup; once the plugin is listed in a Claude Code plugin marketplace, install is fully `/plugin`-guided. Until then, use Option A (npm) above — same server, same tools.

### Option F — CI / headless

This server is for **interactive** use with Claude. For a build pipeline that pushes automatically, use the **CI/CD integration** shown on your project's screen in the Test Nexus app — it performs the same validated, signed-URL upload without needing Claude in the loop. (A single-shot `curl` isn't supported: uploads use a three-step signed-URL flow with server-side SHA verification.)

---

## Usage

Just talk to Claude:

```
"Build the app and push it to my phone"
"Run assembleDebug and send it to Test Nexus with notes: fixed the login crash"
"Push app/build/outputs/apk/release/app-release.apk with version 2.1.0"
"List the last 5 TestNexus builds on the develop branch"
"Download TestNexus build b_ab12… to ~/Desktop/test.apk"
```

> **Running more than one MCP?** Claude routes each request to whichever server best matches your wording. If you also have others installed (filesystem, GitHub, …), name this one — *"push it to **testnexus**"* (or whatever name you used in `claude mcp add <name> …`) — so the build goes to the right place. With only this MCP installed, it isn't required.

**The power pattern** — code + build + deliver in one breath:

```
"Fix the null-pointer crash in LoginViewModel, build the app, and push it to my phone"
```

Claude reads the code, fixes the bug, runs `./gradlew assembleDebug`, calls `push_build`, and your phone buzzes with the new build.

### APK auto-detection

If you don't name a path, the server checks (in order): `app/build/outputs/apk/debug/app-debug.apk`, `…/dev/debug/app-dev-debug.apk`, `…/release/app-release.apk`, `…/prod/release/app-prod-release.apk`, then the most-recently-modified `.apk` under `app/build/outputs/apk/`.

---

## Security

Security is the point of a build-delivery tool — you're moving executables to devices. Test Nexus MCP is built to keep that safe **by default**:

- 🔏 **Signature-pinned delivery.** The backend records the APK's signing certificate and pins it on first use. A build signed by a **different** key than your project's trusted signer is **held for owner review**, not silently delivered — so your key alone can't deliver an unapproved build to your testers.
- 🧮 **End-to-end SHA-256 integrity.** Computed locally, verified by the server after upload, and **re-verified on the device** before install. Any mismatch is rejected.
- 🧱 **Project-scoped file access.** The `apk_path` / `output_path` arguments stay inside your project root — the server won't read or write anywhere else.
- 🔑 **API key never logged.** Sent only as an HTTP header; never printed in tool output, never written to disk by this server.
- 🔒 **Credentials stay put.** Your API key is sent only to the Test Nexus backend, over HTTPS — never to any other destination.
- 🧼 **Private by default.** Error messages are cleaned of local file paths and usernames before they ever reach the model or a transcript.
- 📡 **Zero telemetry.** No analytics, no phone-home, no usage tracking. HTTPS only.
- 🔍 **Open source + provenance.** Every line is auditable, and the npm package is signed with build provenance.

### Handling secrets

**Never commit your API key.**

| Environment | Where to keep it |
|---|---|
| CLI (local) | Shell env var (`~/.bashrc` / `~/.zshrc`) |
| Desktop app | The server's env config (stored in your OS keychain) |
| Web / IDE (`.mcp.json`) | An env-var reference `"${TESTNEXUS_API_KEY}"` — never the literal value |
| CI/CD | GitHub Secrets, etc. |

Rotate anytime from the project screen in the app (**Rotate API Key**) — it invalidates the old key immediately.

---

## Privacy — what data is collected

`push_build` uploads more than the APK. To **your** Test Nexus project's backend (Google Cloud / Firebase), which notifies your project members, it sends:

| Data | Source | Why |
|---|---|---|
| APK bytes | the `.apk` you push | the build your testers install |
| SHA-256 + size | computed locally | integrity (re-verified on download/device) |
| Version name | APK manifest (or your override) | shown to recipients |
| Git **branch**, **commit SHA**, **commit message** | `git` in your project root | shown alongside the build so the team knows what they're installing |

> ⚠️ **The commit message is free text you author** and is uploaded verbatim — don't put secrets or personal data in the commit message of a build you push.

**Not collected:** your source code (only the compiled APK + those three git fields), your local file paths (errors are sanitized), any credential other than the API key you set, and no usage telemetry. `list_builds` / `download_build` send only your API key and the query/build-id.

Full details and your rights: [Privacy Policy](https://twocan.us/privacy-policy) · [Data & Privacy FAQ](https://twocan.us/data-privacy-faq).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| **"No APK found"** | Run `./gradlew assembleDebug` first, or name the path: *"push /path/to/my.apk"*. |
| **"TESTNEXUS_API_KEY not configured"** | The env var isn't set. `export TESTNEXUS_API_KEY=ri_…`, then **restart** Claude Code. Check with `echo $TESTNEXUS_API_KEY`. |
| **"Upload failed (HTTP 401)"** | Key is wrong/expired. Verify it starts with `ri_`; rotate it in the app (Project → Rotate API Key). |
| **"Exceeds 300 MB limit"** | The APK is over the cap. Push a smaller variant (e.g. a minified release build). |
| **"Not a valid ZIP/APK (bad magic bytes)"** | The file isn't a real APK — rebuild, or check it isn't corrupted (`file app/…/app-debug.apk`). |
| **Build **held for signer review** / not downloadable** | Expected for a **new signing key** — approve the signer once in the app (owner), then it delivers. |
| **MCP not showing up** | Verify Node 20+ (`node --version`), run `claude mcp list`, and restart Claude Code. |

---

## Requirements

- **Node.js 20+** (uses `openAsBlob` for streaming uploads; a **native** ZIP reader — no `unzip` binary needed)
- **`git`** (for branch/commit metadata)
- **[Test Nexus Android app](https://play.google.com/store/apps/details?id=us.twocan.testnexus)** on at least one phone

---

## License

Apache-2.0 — see [LICENSE](LICENSE).

Part of the [Test Nexus](https://play.google.com/store/apps/details?id=us.twocan.testnexus) platform by [Twocan Software](https://twocan.us).
