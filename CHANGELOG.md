# What's New

Release highlights for Test Nexus MCP. Install or update anytime with one command:

```
npx -y @twocan/testnexus-mcp
```

## 1.1.3

- **Build notes now attached.** If you pass `notes` (a changelog or build description) to `push_build`, it's now actually sent with the build and shown to your team — previously it was accepted but dropped.
- **Clearer tool descriptions.** `push_build` now states plainly that a build signed with an untrusted key is held for owner approval, and that a build reports its real outcome and recipient count rather than assuming delivery.

## 1.1.2

- **Honest push results.** When a build is held for signer review — its signing key isn't on the project's trusted list yet — `push_build` now clearly reports it as **held and not yet delivered**, instead of reporting success. You'll know to approve the signer in the TestNexus app before your team can install it.

## 1.1.1

- **Larger builds.** Push APKs up to 200 MB.

## 1.1.0

Test Nexus MCP is now available on **npm** — a single command to install, and it stays up to date automatically.

- **Easier to get started.** A simpler install path and clearer, friendlier setup guidance.
- **More dependable delivery.** Smoother, more reliable delivery of your builds to your testers' devices.
- **Polished throughout.** Performance, stability, and overall quality improvements.

_Requires Node.js 20 or newer._

## Earlier releases

Earlier versions introduced the core experience: build, deliver, and manage your Android test builds right from Claude, with instant, over-the-air delivery to your whole team's phones.
