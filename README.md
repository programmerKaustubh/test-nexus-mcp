# Test Nexus MCP

Ask Claude:

> "Build the app and push it to my phone."

Thirty seconds later, your phone buzzes with the new APK. No USB cables, no manual file transfers, no emailing builds to the team.

This is a [Model Context Protocol](https://modelcontextprotocol.io/) server that plugs into Claude Code and lets Claude push your Android builds to every team member's phone over the air.

---

## Why

- **One sentence, not ten steps.** Replace `./gradlew assembleDebug && scp app-debug.apk …` (and the Slack message, and the reinstall) with a single instruction to Claude.
- **Team-wide delivery, not just yours.** Every member added to the Test Nexus project receives a push notification and can install in one tap.
- **Verified integrity.** SHA-256 is computed locally, sent with the upload, and the server re-checks it. A corrupted upload is rejected before it reaches phones.
- **Automatic git context.** The branch name, commit SHA, and latest commit message travel with the APK so your team sees exactly which build they're installing.
- **No extra accounts to manage.** The only credential is your project's API key, shown once in the Test Nexus Android app.
- **Auditable.** The whole server is a single `src/index.js` file under the Apache 2.0 license.

---

## What Claude can do

| Tool | What it does |
|------|--------------|
| `push_build` | Validates the APK, computes SHA-256, extracts git metadata, and uploads it. Every team member gets a push notification. |
| `list_builds` | Shows recent builds — version, branch, timestamp, size. Filter by branch or limit results. |
| `download_build` | Downloads a specific APK from the cloud to your local machine. SHA-256 is verified after download. |

### What gets validated before upload

1. File exists and ends in `.apk`
2. File is non-empty
3. File is under 100 MB
4. ZIP magic bytes (`PK\x03\x04`) are correct
5. Contains `AndroidManifest.xml` and `classes*.dex`
6. Contains `META-INF/` (signed)

If any check fails, Claude tells you what's wrong and nothing is uploaded.

---

## Prerequisites

1. **Node.js 20 or newer** — check with `node --version`.
2. **The Test Nexus Android app** on your phone — [Get it on Google Play](https://play.google.com/store/apps/details?id=us.twocan.testnexus).
3. **A Test Nexus project** created in the app (App Hub → Remote Install → +).
4. **Your API key** (starts with `ri_`, shown once in the project detail screen when the project is created).

Save the API key somewhere safe — rotation is supported in the app if you lose it.

---

## Install

Pick whichever flow matches how you use Claude.

### Option A — Claude Code CLI (terminal)

Run once, then the `push_build`, `list_builds`, and `download_build` tools become available in every `claude` session.

The recommended pattern uses `claude mcp add`'s `-e` flag, which scopes the environment variables to the MCP subprocess only — no shell profile edits, no leaking keys into every process you launch. Works the same on every OS.

**macOS / Linux:**

```bash
git clone https://github.com/programmerKaustubh/test-nexus-mcp.git
cd test-nexus-mcp
npm install
claude mcp add testnexus \
  -e TESTNEXUS_API_KEY=ri_your_key_here \
  -e TESTNEXUS_PROJECT_ROOT=/absolute/path/to/your/android/project \
  -- node src/index.js
```

**Windows (PowerShell):**

```powershell
git clone https://github.com/programmerKaustubh/test-nexus-mcp.git
cd test-nexus-mcp
npm install
claude mcp add testnexus `
  -e TESTNEXUS_API_KEY=ri_your_key_here `
  -e TESTNEXUS_PROJECT_ROOT=C:/Users/you/path/to/your/android/project `
  -- node src/index.js
```

**Windows (CMD — single line, no continuations):**

```cmd
claude mcp add testnexus -e TESTNEXUS_API_KEY=ri_your_key_here -e TESTNEXUS_PROJECT_ROOT=C:/Users/you/path/to/your/android/project -- node src/index.js
```

> **What is `TESTNEXUS_PROJECT_ROOT`?** The directory the MCP should treat as your Android project root — where Gradle puts APKs under `app/build/outputs/apk/` and where git metadata (branch, commit, message) is read from. If omitted, the server falls back to `process.cwd()`, which for GUI clients is often their own install directory, not your project. Set it explicitly and uploads always get the right git context.

**Prefer shell env vars?** It still works — run `claude mcp add testnexus -- node src/index.js` without the `-e` flags, then export `TESTNEXUS_API_KEY` and `TESTNEXUS_PROJECT_ROOT` in your shell profile. The `-e` approach is cleaner because the config is visible in `claude mcp list` and survives shell changes.

### Option B — Claude Code plugin (GUI)

If you use Claude Code through its plugin interface, install from the plugin manifest in this repo. The plugin declares `api_key` as a sensitive user-config field, so Claude Code prompts for it in a password-style input — no environment variable wrangling.

1. Clone the repo anywhere on disk.
2. Point your Claude Code plugin installation at this folder's `.claude-plugin/plugin.json`.
3. When prompted, paste your API key (the value stays local — `sensitive: true` keeps it out of logs and UI previews).

That's the whole setup. No config file edits, no shell reloads.

### Option C — Claude Desktop config file

For Claude Desktop (or any MCP-aware desktop client that reads a JSON config), add the server to your config file manually.

**Locate the config file**

| OS | Typical path |
|----|--------------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

**Open it quickly**

PowerShell:

```powershell
notepad "$env:APPDATA\Claude\claude_desktop_config.json"
```

CMD:

```cmd
notepad "%APPDATA%\Claude\claude_desktop_config.json"
```

macOS / Linux:

```bash
$EDITOR ~/Library/Application\ Support/Claude/claude_desktop_config.json   # macOS
$EDITOR ~/.config/Claude/claude_desktop_config.json                         # Linux
```

**Add this block** (merge it into an existing `mcpServers` object if you already have one — don't overwrite other connectors you've registered):

```json
{
  "mcpServers": {
    "testnexus": {
      "command": "node",
      "args": ["/absolute/path/to/test-nexus-mcp/src/index.js"],
      "env": {
        "TESTNEXUS_API_KEY": "ri_your_key_here",
        "TESTNEXUS_PROJECT_ROOT": "/absolute/path/to/your/android/project"
      }
    }
  }
}
```

Replace both paths and your API key. Save the file and restart Claude Desktop (see the note below — closing the window isn't enough). The `push_build` tool appears on next launch.

**Windows path tip — use forward slashes in JSON.** `"C:\Users\..."` breaks JSON parsing. The two safe forms:

- `"C:/Users/you/test-nexus-mcp/src/index.js"` (forward slashes — Node accepts them on Windows)
- `"C:\\Users\\you\\test-nexus-mcp\\src\\index.js"` (double-escaped backslashes)

Forward slashes are simpler and easier to read. Spaces in paths are fine inside JSON strings — no extra escaping needed.

**Full-quit Claude Desktop after editing the config.** Closing the window leaves the app running in the system tray (Windows) or the dock (macOS), and the MCP config is only re-read on a cold start:

- **Windows** — right-click the Claude icon in the system tray (bottom-right, may be under the "hidden icons" chevron) → **Quit**. Then relaunch from Start menu.
- **macOS** — `⌘Q` from the menu bar, not the red close button.

> Claude Code Web and IDE extensions (VS Code, JetBrains) pick up MCP servers via a project-level `.mcp.json` with the same shape as the block above — point `args` at `src/index.js` and set both `TESTNEXUS_API_KEY` and `TESTNEXUS_PROJECT_ROOT` in `env`.

### Verifying your install

Regardless of which option you used, confirm the connector loaded before you try to push anything:

- **Claude Code CLI** — `claude mcp list` shows `testnexus`. Start a session and ask *"What TestNexus tools do you have?"* — Claude should mention `push_build`, `list_builds`, `download_build`.
- **Claude Desktop** — click the **hammer / tools icon** in the chat UI; `testnexus` should be listed with its 3 tools. Alternatively, ask the same question in a new conversation.
- **Safest first test** — ask *"List the last five builds in Test Nexus"*. `list_builds` is read-only, so there's no risk of a surprise upload while you're still verifying.

---

## Using it

Once installed, talk to Claude naturally. Some examples:

```
Build the app and push it to my phone.

Run assembleDebug and send it to Test Nexus.

Push app/build/outputs/apk/release/app-release.apk with notes: fixed the login crash.

Show me the last five builds on the main branch.

Download build abc12345 from the cloud.
```

The most powerful pattern combines Claude's coding ability with a push:

```
Fix the null pointer crash in LoginViewModel, build the app, and push it to my phone.
```

Claude reads the code, fixes the bug, runs the build, calls `push_build`, and your phone buzzes — all in one instruction.

### APK auto-detection

When you don't specify a path, the server looks in these locations in order, relative to `TESTNEXUS_PROJECT_ROOT` (or `process.cwd()` if that's unset):

1. `app/build/outputs/apk/debug/app-debug.apk`
2. `app/build/outputs/apk/dev/debug/app-dev-debug.apk`
3. `app/build/outputs/apk/release/app-release.apk`
4. `app/build/outputs/apk/prod/release/app-prod-release.apk`
5. The most recently modified `.apk` anywhere under `app/build/outputs/apk/`.

---

## Where it works

| Claude environment | Status |
|---|---|
| Claude Code CLI (terminal) | ✅ |
| Claude Desktop (macOS / Windows / Linux) | ✅ |
| Claude Code plugins (VS Code, JetBrains) | ✅ via project-level `.mcp.json` |
| Claude mobile apps (iOS / Android) | ❌ Not supported |

Mobile doesn't support MCPs that use the local stdio transport — which this one does. Your phone can't spawn a Node.js child process and has no network path to reach `localhost` on your computer. If a Claude mobile session tells you *"TestNexus MCP connector is not available for this session"*, that's why — not a config issue.

Pushing builds is inherently a desktop workflow anyway: the APK lives on your dev machine, `git` metadata has to be read from your project directory, and SHA-256 has to be computed from the local file. Your phone is the **install target**, not the controller.

If you want a mobile dashboard to view build history / trigger downloads remotely, that would require a separate remote-MCP companion we haven't built. Open an issue if it's important to you.

---

## Security

- **The API key is never logged.** It is sent as an HTTP header only. Claude tool output does not echo it.
- **HTTPS only.** All uploads go over TLS to the Test Nexus backend.
- **Path sandboxing.** The `apk_path` argument cannot escape your project root — `../../etc/passwd`-style attacks are rejected before any I/O.
- **Structured JSON output.** All tool responses are JSON so that a malicious APK filename or commit message can't inject prompts into Claude.
- **Zero telemetry.** No analytics, no usage tracking, no phone-home of any kind.
- **Auditable.** The whole server is ~350 lines in a single `src/index.js`. Read it before you install it.

### Where to put your API key

| Environment | Where the key lives |
|-------------|---------------------|
| CLI (local) | A shell environment variable (`~/.zshrc`, `setx`, etc.) |
| Plugin install | In the plugin's sensitive-field prompt (stored via your OS keychain if available) |
| Desktop config file | Directly in `claude_desktop_config.json` (keep that file out of any shared repo) |
| CI / CD | Your CI secret store (GitHub Secrets, etc.) — see note below |

> **Never commit the API key.** If you use a project-level `.mcp.json`, reference the environment variable rather than hardcoding the key, and keep `.mcp.json` in `.gitignore`.

### For CI / CD

You don't actually need the MCP server in CI — just a curl call. The server exists for interactive Claude sessions; CI pipelines talk to the webhook directly. Ask in an issue if you want the exact curl.

---

## Troubleshooting

Group by the symptom you're actually seeing. The first two are the most common by far.

### `testnexus` doesn't appear in Claude Desktop at all

#1 cause: **the window was closed, but the app is still running in the system tray / menu bar**. MCP config is only read on a cold start. Fix: follow the [full-quit instructions above](#option-c--claude-desktop-config-file). If `testnexus` shows up in the hammer-icon menu after a real restart, you're done.

If it's still missing after a clean restart, open the MCP log — the first few lines show the spawn error:

| OS | Log path |
|---|---|
| Windows | `%APPDATA%\Claude\logs\mcp-server-testnexus.log` |
| macOS | `~/Library/Logs/Claude/mcp-server-testnexus.log` |
| Linux | `~/.config/Claude/logs/mcp-server-testnexus.log` |

Quick tail from PowerShell:
```powershell
Get-Content "$env:APPDATA\Claude\logs\mcp-server-testnexus.log" -Tail 50
```

### `testnexus` doesn't appear in Claude Code CLI

Run `claude mcp list`. If it's not there, the registration didn't persist — some CLI upgrades reset MCP config. Re-run your `claude mcp add testnexus -e ... -- node ...` command. Use `claude mcp get testnexus` to inspect what's currently registered, including the env vars.

### "TestNexus MCP connector is not available for this session" (Claude mobile)

Expected, not a bug. See [Where it works](#where-it-works) — this MCP uses stdio transport and the mobile app can't spawn local Node processes. Use Claude Desktop or the CLI from your computer instead.

### `node: not found` / `ENOENT` in the log

Claude Desktop inherits the Windows shell PATH, but `nvm`-managed Node installs sometimes aren't exposed to GUI apps. Fix by using the **absolute path to node** in the Desktop config:

```json
"command": "C:/Program Files/nodejs/node.exe"
```

Find where Node actually lives:
- PowerShell / CMD: `where node`
- macOS / Linux: `which node`

Paste that absolute path into `"command"`.

### JSON syntax errors in `claude_desktop_config.json`

Claude Desktop silently refuses to load a config file that doesn't parse — no error in the UI, the MCP just doesn't appear. Common mistakes:

- **Trailing comma** after the last property in an object → breaks parsing.
- **Backslashes in Windows paths** — `"C:\Users\..."` is invalid JSON. Use `"C:/Users/..."` (forward slashes) or `"C:\\Users\\..."` (doubled).
- **Missing closing brace / bracket** — copy-paste artifacts from merging with another connector's config.

Drop your config into any online JSON validator if Claude silently refuses to load it.

### Upload works but `branch`, `commit`, `commitMessage` come back empty

The MCP fell back to `process.cwd()` instead of your project dir, so `git rev-parse` ran somewhere that isn't a git repo. Set `TESTNEXUS_PROJECT_ROOT`:

- **CLI** — re-run `claude mcp add` with `-e TESTNEXUS_PROJECT_ROOT=/absolute/path/to/project` (or `claude mcp remove testnexus` first to replace cleanly).
- **Desktop config** — add `"TESTNEXUS_PROJECT_ROOT"` inside the `"env"` block, save, and full-quit-then-relaunch.

### "TESTNEXUS_API_KEY not configured"

The env var isn't set in the process Claude actually launched. Where to look depends on how you registered:

- **CLI with `-e TESTNEXUS_API_KEY=...`** — run `claude mcp get testnexus` to confirm the key is baked into the registration. If you see only `command` and `args` but no env, the `-e` didn't take; re-run `claude mcp add`.
- **Shell export** — `setx` on Windows only affects *new* shells; close and reopen the terminal. On macOS/Linux, `source ~/.zshrc` (or `.bashrc`).
- **Desktop config file** — open the file and confirm the `"env"` block literally contains `TESTNEXUS_API_KEY`. Re-full-quit and relaunch Claude Desktop after any edit.

### "Upload failed (HTTP 401)" or "Invalid API key"

The key is wrong, rotated, or a typo (extra whitespace when you pasted). Fix:

1. In the Test Nexus app → Project Detail → **Rotate API Key**
2. Copy the new `ri_...` key
3. Update wherever you stored it: `-e` flag in `claude mcp add`, shell profile, or Desktop config JSON
4. **Restart Claude** after updating — existing MCP subprocesses hold the old key until respawn

### "No APK found"

The MCP looked at the [auto-detection paths](#apk-auto-detection) and none exist. Either:
- Run the Gradle build first: `./gradlew assembleDebug` (or whichever variant you want)
- Pass the absolute path explicitly to Claude: *"Push `C:/Users/you/project/app/build/outputs/apk/debug/app-debug.apk` to Test Nexus"*

### "Not a valid ZIP/APK (bad magic bytes)"

The file you pointed at isn't an APK. Common causes:
- Gradle build didn't finish — check its output, not just the exit code
- Pointed at a JAR, AAR, or ZIP by mistake

Sanity check:
```bash
file app/build/outputs/apk/debug/app-debug.apk
```
Should report "Zip archive data" (APKs are just signed ZIPs).

### Standalone smoke test (isolates the MCP server from Claude)

When nothing's making sense, run the server directly from a terminal — if it hangs, it's healthy; if it errors immediately, you have your diagnostic:

**macOS / Linux:**
```bash
TESTNEXUS_API_KEY=ri_... TESTNEXUS_PROJECT_ROOT=/path/to/project node src/index.js
```

**Windows (PowerShell):**
```powershell
$env:TESTNEXUS_API_KEY = "ri_..."
$env:TESTNEXUS_PROJECT_ROOT = "C:/path/to/project"
node src/index.js
```

**Windows (CMD):**
```cmd
set TESTNEXUS_API_KEY=ri_...
set TESTNEXUS_PROJECT_ROOT=C:/path/to/project
node src\index.js
```

Expected: the process hangs waiting for stdio input. Ctrl-C to exit. If it errors on startup, the error message is in the terminal — much more informative than Claude's surfaced version. Open an issue with the error, your OS, and `node --version`.

### Nothing on this list matches

Open a GitHub issue with:
- Which Claude environment (CLI / Desktop / IDE plugin)
- OS and version
- `node --version`
- The exact error message Claude showed
- The first 20 lines of the MCP log (path above)

---

## License

Apache 2.0 — see [LICENSE](LICENSE). Part of the [Test Nexus](https://play.google.com/store/apps/details?id=us.twocan.testnexus) platform by [Twocan Software](https://twocan.us).

---

## Contributing

This repository's `main` branch is a **release branch with squashed history** — each version ships as a single commit force-pushed from upstream. Please open issues instead of PRs against `main`; if you have a patch to propose, attach it to an issue and we'll fold it into the next release.
