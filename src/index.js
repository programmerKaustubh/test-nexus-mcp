#!/usr/bin/env node
/**
 * TestNexus MCP Server for Claude Code
 *
 * Provides native Claude Code tools for pushing Android APK builds
 * to the TestNexus Build Portal. Auto-detects APKs from Gradle output,
 * validates them locally, and uploads to the TestNexus webhook.
 *
 * Tools:
 *   push_build     — Validate and upload the latest APK
 *   list_builds    — List recent builds from TestNexus cloud
 *   download_build — Download a specific build to the local machine
 *
 * Security:
 *   - Zero telemetry (Decision 11)
 *   - API key stored in keychain or env var (Decision 7)
 *   - HTTPS-only outbound calls
 *   - Structured JSON output (prompt injection defense)
 *   - No arbitrary file reads/writes — only Gradle APK output dirs and validated download paths
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { openSync, readSync, closeSync, createReadStream, createWriteStream, existsSync, statSync, readdirSync, unlinkSync, mkdirSync } from "fs";
import { openAsBlob } from "fs";
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { resolve, join, sep, dirname } from "path";
import { homedir } from "os";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

// ================================================================
// Configuration
// ================================================================
const API_KEY = process.env.TESTNEXUS_API_KEY ||
  process.env.CLAUDE_PLUGIN_OPTION_API_KEY || "";
const MAX_APK_SIZE = 100 * 1024 * 1024; // 100 MB

// Default: the working directory the server was launched from. When the MCP
// server is started by a desktop client outside the user's project directory
// (common on macOS/Windows), `process.cwd()` can point at the client's
// install root and git metadata comes back empty. Letting the user set
// TESTNEXUS_PROJECT_ROOT fixes that without changing every caller.
const PROJECT_ROOT = process.env.TESTNEXUS_PROJECT_ROOT || process.cwd();

// ================================================================
// Error sanitization
// ================================================================
/**
 * Strip the absolute PROJECT_ROOT path from error messages before returning
 * them to the LLM. Node's `fs` errors embed full absolute paths, which leak
 * the user's directory structure + username to the conversation transcript
 * (and anywhere the transcript ends up — screenshots, cached history, issues).
 * Replacing the root with `.` keeps the message diagnostically useful while
 * removing the identifying prefix.
 */
function sanitizeErrorMessage(msg) {
  if (!msg) return "(unknown error)";
  // Layered redaction: PROJECT_ROOT catches the canonical form; homedir() catches
  // paths outside PROJECT_ROOT but inside the user home (fs errors on arbitrary
  // files the operator accidentally pointed at); the three regex layers catch
  // cases where the fs error string uses slightly different casing or separator
  // than what resolve() / homedir() return.
  let s = String(msg);
  s = s.split(resolve(PROJECT_ROOT)).join(".");
  s = s.split(homedir()).join("~");
  s = s.replace(/([A-Za-z]:\\Users\\)[^\\]+/gi, "$1<user>");
  s = s.replace(/(\/home\/)[^/]+/g, "$1<user>");
  s = s.replace(/(\/Users\/)[^/]+/g, "$1<user>");
  return s;
}

// Production backend. Branded Firebase Hosting domain — rewrites map
// `/<functionName>` to the corresponding Cloud Function. Public, non-secret:
// this is the same URL advertised on the website and in the privacy policy.
const BASE_URL = "https://api.twocan.us";

// ================================================================
// Endpoint URL builder
// ================================================================
function getEndpointUrl(functionName) {
  return `${BASE_URL}/${functionName}`;
}

// ================================================================
// Path Safety — prevent traversal outside project root
// ================================================================
function assertWithinRoot(requestedPath, root) {
  const normalizedRoot = resolve(root) + sep;
  const normalizedPath = resolve(requestedPath);
  // Allow exact match (root itself) or child paths
  if (normalizedPath !== resolve(root) && !normalizedPath.startsWith(normalizedRoot)) {
    throw new Error(
      `Path must be within project root. ` +
      `Resolved "${normalizedPath}" is outside "${resolve(root)}".`
    );
  }
}

// ================================================================
// APK Detection
// ================================================================
function findLatestApk(projectRoot) {
  const candidates = [
    "app/build/outputs/apk/debug/app-debug.apk",
    "app/build/outputs/apk/dev/debug/app-dev-debug.apk",
    "app/build/outputs/apk/release/app-release.apk",
    "app/build/outputs/apk/prod/release/app-prod-release.apk",
  ];

  for (const candidate of candidates) {
    const fullPath = resolve(projectRoot, candidate);
    if (existsSync(fullPath)) return fullPath;
  }

  // Fallback: find most recently modified .apk in build/outputs
  const outputDir = resolve(projectRoot, "app/build/outputs/apk");
  if (!existsSync(outputDir)) return null;

  let newest = null;
  let newestTime = 0;
  function walk(dir, depth = 0) {
    if (depth > 6) return; // Safety: prevent deep recursion in unusual build dirs
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name.endsWith(".apk")) {
        const mtime = statSync(full).mtimeMs;
        if (mtime > newestTime) { newest = full; newestTime = mtime; }
      }
    }
  }
  walk(outputDir);
  return newest;
}

// ================================================================
// APK Validation (6-layer, matches CLI)
// ================================================================
function validateApk(apkPath) {
  if (!existsSync(apkPath)) return { valid: false, error: "File not found" };
  if (!apkPath.endsWith(".apk")) return { valid: false, error: "Must end in .apk" };

  const stat = statSync(apkPath);
  if (stat.size === 0) return { valid: false, error: "File is empty" };
  if (stat.size > MAX_APK_SIZE) return { valid: false, error: `Exceeds ${MAX_APK_SIZE / (1024*1024)} MB limit` };

  // Magic bytes check (read only 4 bytes, not the entire file)
  const header = Buffer.alloc(4);
  const fd = openSync(apkPath, "r");
  try {
    readSync(fd, header, 0, 4, 0);
  } finally {
    closeSync(fd);
  }
  if (header[0] !== 0x50 || header[1] !== 0x4B || header[2] !== 0x03 || header[3] !== 0x04) {
    return { valid: false, error: "Not a valid ZIP/APK (bad magic bytes)" };
  }

  // Structure check — Node-native ZIP central directory scan (no unzip dependency)
  try {
    const entries = listZipEntries(apkPath);
    if (!entries.some((e) => e === "AndroidManifest.xml")) return { valid: false, error: "Missing AndroidManifest.xml" };
    if (!entries.some((e) => /^classes\d*\.dex$/.test(e))) return { valid: false, error: "Missing classes.dex" };
    if (!entries.some((e) => e.startsWith("META-INF/"))) return { valid: false, error: "Missing META-INF (unsigned)" };
  } catch (e) {
    return { valid: false, error: `Failed to inspect APK: ${e.message}` };
  }

  return { valid: true, sizeBytes: stat.size };
}

/**
 * List file entries in a ZIP archive by reading the central directory.
 * Pure Node.js — no external dependencies (replaces `unzip -l`).
 * Only reads the last 64KB + central directory — safe for large APKs.
 */
function listZipEntries(zipPath) {
  const fd = openSync(zipPath, "r");
  try {
    const fileSize = statSync(zipPath).size;
    // Read the last 64KB to find the End of Central Directory record
    const tailSize = Math.min(65557, fileSize);
    const tail = Buffer.alloc(tailSize);
    readSync(fd, tail, 0, tailSize, fileSize - tailSize);

    // Find EOCD signature (0x06054b50) scanning backwards
    let eocdOffset = -1;
    for (let i = tailSize - 22; i >= 0; i--) {
      if (tail[i] === 0x50 && tail[i+1] === 0x4b && tail[i+2] === 0x05 && tail[i+3] === 0x06) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset === -1) throw new Error("Not a valid ZIP (no EOCD)");

    const cdOffset = tail.readUInt32LE(eocdOffset + 16);
    const cdSize = tail.readUInt32LE(eocdOffset + 12);
    const entryCount = tail.readUInt16LE(eocdOffset + 10);

    // Bounds-check the central directory against the actual file size.
    // cdSize and cdOffset are attacker-controlled 32-bit fields read
    // straight from the ZIP header — without this guard, a forged cdSize
    // would attempt a ~4 GiB Buffer.alloc on a tiny file, triggering OOM
    // or a process abort before validateApk's file-size cap matters.
    if (cdSize <= 0 || cdOffset < 0 || cdOffset + cdSize > fileSize) {
      throw new Error("Invalid ZIP central directory bounds");
    }

    // Read the central directory
    const cd = Buffer.alloc(cdSize);
    readSync(fd, cd, 0, cdSize, cdOffset);

    const entries = [];
    let pos = 0;
    for (let i = 0; i < entryCount && pos < cdSize; i++) {
      if (cd.readUInt32LE(pos) !== 0x02014b50) break; // Central dir entry signature
      const nameLen = cd.readUInt16LE(pos + 28);
      const extraLen = cd.readUInt16LE(pos + 30);
      const commentLen = cd.readUInt16LE(pos + 32);
      const name = cd.toString("utf8", pos + 46, pos + 46 + nameLen);
      entries.push(name);
      pos += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    closeSync(fd);
  }
}

// ================================================================
// Git metadata extraction
// ================================================================
function getGitMetadata(cwd) {
  const run = (args) => {
    try { return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 5000 }).trim(); }
    catch { return ""; }
  };
  return {
    branch: run(["rev-parse", "--abbrev-ref", "HEAD"]),
    commitSha: run(["rev-parse", "HEAD"]),
    commitMessage: run(["log", "-1", "--pretty=%s"]),
  };
}

// ================================================================
// SHA-256 (streaming — safe for 150 MB APKs)
// ================================================================
function computeSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", (err) => reject(err));
  });
}

// ================================================================
// Two-step upload to TestNexus
// Step 1: Send metadata → get signed upload URL
// Step 2: Upload APK directly to Storage via signed URL
// Step 3: Call finalize → server verifies SHA-256, activates build, sends FCM
// ================================================================
async function uploadToWebhook(apkPath, metadata) {
  if (!API_KEY) throw new Error("TESTNEXUS_API_KEY not configured");

  // Step 1: Request signed upload URL
  const step1Response = await fetch(getEndpointUrl("receiveBuild"), {
    method: "POST",
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json",
      "X-CLI-Version": "mcp-1.0.0",
    },
    body: JSON.stringify({
      sha256: metadata.sha256,
      apkSizeBytes: metadata.apkSizeBytes,
      versionName: metadata.versionName || "",
      branch: metadata.branch,
      commitSha: metadata.commitSha,
      commitMessage: metadata.commitMessage,
    }),
    signal: AbortSignal.timeout(30000),
    // CWE-522: refuse to follow redirects — undici preserves custom auth
    // headers like X-API-Key on cross-origin 3xx, leaking the key.
    redirect: "error",
  });

  if (!step1Response.ok) {
    const body = await step1Response.text().catch(() => "");
    throw new Error(`Failed to get upload URL (HTTP ${step1Response.status}): ${body}`);
  }

  const { uploadUrl, buildId } = await step1Response.json();

  // Step 2: Upload APK directly to Firebase Storage via signed URL
  // openAsBlob streams from disk — no full file in memory
  const apkBlob = await openAsBlob(apkPath, { type: "application/vnd.android.package-archive" });

  const step2Response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
    },
    body: apkBlob,
    signal: AbortSignal.timeout(300000), // 5-minute timeout for large uploads
  });

  if (!step2Response.ok) {
    const body = await step2Response.text().catch(() => "");
    throw new Error(`Storage upload failed (HTTP ${step2Response.status}): ${body}`);
  }

  // Step 3: Finalize — server verifies SHA-256, marks active, sends FCM
  const step3Response = await fetch(getEndpointUrl("finalizeBuildUpload"), {
    method: "POST",
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json",
      "X-CLI-Version": "mcp-1.0.0",
    },
    body: JSON.stringify({ buildId }),
    signal: AbortSignal.timeout(120000),
    redirect: "error", // CWE-522: never forward X-API-Key on cross-origin 3xx
  });

  if (!step3Response.ok) {
    const body = await step3Response.text().catch(() => "");
    throw new Error(`Finalize failed (HTTP ${step3Response.status}): ${body}`);
  }

  return await step3Response.json();
}

// ================================================================
// Fetch builds from TestNexus cloud
// ================================================================
async function fetchBuilds({ limit = 10, branch = "" } = {}) {
  if (!API_KEY) throw new Error("TESTNEXUS_API_KEY not configured");

  const endpoint = getEndpointUrl("listBuildsHttp");
  const url = new URL(endpoint);
  url.searchParams.set("limit", String(limit));
  if (branch) url.searchParams.set("branch", branch);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "X-API-Key": API_KEY,
      "X-CLI-Version": "mcp-1.0.0",
    },
    signal: AbortSignal.timeout(30000),
    redirect: "error", // CWE-522: never forward X-API-Key on cross-origin 3xx
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Failed to list builds (HTTP ${response.status}): ${body}`);
  }

  return await response.json();
}

// ================================================================
// Download a build from TestNexus cloud (streaming + SHA-256)
// ================================================================
async function downloadBuild(buildId, outputPath) {
  if (!API_KEY) throw new Error("TESTNEXUS_API_KEY not configured");

  const endpoint = getEndpointUrl("downloadBuildHttp");
  const url = `${endpoint}?buildId=${encodeURIComponent(buildId)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-API-Key": API_KEY,
      "X-CLI-Version": "mcp-1.0.0",
    },
    signal: AbortSignal.timeout(300000), // 5-minute timeout for large downloads
    redirect: "error", // CWE-522: never forward X-API-Key on cross-origin 3xx
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Download failed (HTTP ${response.status}): ${body}`);
  }

  const expectedSha256 = response.headers.get("X-APK-SHA256") || "";

  // Stream to file while computing SHA-256 on-the-fly
  const hash = createHash("sha256");
  const fileStream = createWriteStream(outputPath);
  const nodeReadable = Readable.fromWeb(response.body);

  try {
    await pipeline(
      nodeReadable,
      async function* (source) {
        for await (const chunk of source) {
          hash.update(chunk);
          yield chunk;
        }
      },
      fileStream,
    );
  } catch (err) {
    // Destroy the write stream and wait for close to release file locks
    // (Windows). Wrap both destroy and unlink in one try so cleanup errors
    // can't mask the original exception.
    try {
      fileStream.destroy();
      await new Promise((r) => fileStream.on("close", r));
      if (existsSync(outputPath)) unlinkSync(outputPath);
    } catch { /* ignore cleanup error to preserve original exception */ }
    throw err;
  }

  const actualSha256 = hash.digest("hex");

  if (expectedSha256 && actualSha256 !== expectedSha256) {
    try { unlinkSync(outputPath); } catch { /* ignore */ }
    throw new Error(
      `SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}. File deleted for safety.`
    );
  }

  const stat = statSync(outputPath);
  return { sha256: actualSha256, sizeBytes: stat.size };
}

// ================================================================
// MCP Server Setup
// ================================================================
const server = new Server(
  { name: "testnexus", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "push_build",
      description: "Validate and upload the latest Android APK build to TestNexus. The APK is delivered to all team members' phones via push notification.",
      inputSchema: {
        type: "object",
        properties: {
          apk_path: {
            type: "string",
            description: "Path to the APK file. If omitted, auto-detects from Gradle output.",
          },
          version_name: {
            type: "string",
            description: "Version name (e.g., '1.4.2'). If omitted, extracted from APK.",
          },
          notes: {
            type: "string",
            description: "Optional build notes or changelog.",
          },
        },
      },
    },
    {
      name: "list_builds",
      description: "List recent Android APK builds from the TestNexus cloud portal. Shows build ID, version, branch, upload time, and size for each build.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Maximum number of builds to return (1-50, default 10).",
          },
          branch: {
            type: "string",
            description: "Filter builds by git branch name. If omitted, shows all branches.",
          },
        },
      },
    },
    {
      name: "download_build",
      description: "Download a specific APK build from TestNexus cloud to the local machine. Use list_builds first to find the build ID.",
      inputSchema: {
        type: "object",
        properties: {
          build_id: {
            type: "string",
            description: "The build ID to download (from list_builds output).",
          },
          output_path: {
            type: "string",
            description: "Where to save the APK file. Defaults to ./<build_id>.apk in the current directory.",
          },
        },
        required: ["build_id"],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "push_build") {
    return await handlePushBuild(args || {});
  }

  if (name === "list_builds") {
    return await handleListBuilds(args || {});
  }

  if (name === "download_build") {
    return await handleDownloadBuild(args || {});
  }

  return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
});

async function handlePushBuild(args) {
  try {
    // Find APK
    const cwd = PROJECT_ROOT;
    let apkPath;
    if (args.apk_path) {
      apkPath = resolve(cwd, args.apk_path);
      // SECURITY: Prevent path traversal outside the project root
      assertWithinRoot(apkPath, cwd);
    } else {
      apkPath = findLatestApk(cwd);
    }
    if (!apkPath) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "error",
            message: "No APK found. Run ./gradlew assembleDebug first, or provide apk_path.",
          }),
        }],
        isError: true,
      };
    }

    // Validate
    const validation = validateApk(apkPath);
    if (!validation.valid) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ status: "error", message: `APK validation failed: ${sanitizeErrorMessage(validation.error)}` }),
        }],
        isError: true,
      };
    }

    // Compute SHA-256 (streaming)
    const sha256 = await computeSha256(apkPath);

    // Git metadata
    const git = getGitMetadata(cwd);

    // Upload
    const result = await uploadToWebhook(apkPath, {
      sha256,
      branch: git.branch,
      commitSha: git.commitSha,
      commitMessage: git.commitMessage,
      versionName: args.version_name || "",
      apkSizeBytes: validation.sizeBytes,
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "success",
          message: "Build pushed to TestNexus. Your team will receive a notification.",
          build_id: result.buildId || "",
          recipients: result.recipients || 0,
          sha256: sha256.substring(0, 16) + "...",
          size_mb: (validation.sizeBytes / (1024 * 1024)).toFixed(1),
          branch: git.branch,
          commit: git.commitSha.substring(0, 7),
        }),
      }],
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ status: "error", message: sanitizeErrorMessage(error.message) }),
      }],
      isError: true,
    };
  }
}

async function handleListBuilds(args) {
  try {
    const limit = args.limit != null ? Math.min(Math.max(Math.floor(args.limit), 1), 50) : 10;
    const branch = args.branch || "";

    const result = await fetchBuilds({ limit, branch });

    const builds = Array.isArray(result) ? result : (result.builds || []);

    // Normalize numeric epoch timestamps to ISO-8601 strings so Claude can
    // reason about build recency ("latest", "yesterday") without guessing
    // whether a number is seconds, millis, or a date string.
    function normalizeTimestamp(val) {
      if (!val) return "";
      if (typeof val === "number") return new Date(val).toISOString();
      if (typeof val === "string" && /^\d+$/.test(val)) return new Date(Number(val)).toISOString();
      return String(val);
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "success",
          count: builds.length,
          builds: builds.map((b) => ({
            build_id: b.buildId || b.id || "",
            version: b.versionName || b.version || "",
            branch: b.branch || "",
            commit: (b.commitSha || "").substring(0, 7),
            uploaded_at: normalizeTimestamp(b.createdAt || b.uploadedAt),
            size_mb: b.apkSizeBytes
              ? (b.apkSizeBytes / (1024 * 1024)).toFixed(1)
              : "",
          })),
        }),
      }],
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ status: "error", message: sanitizeErrorMessage(error.message) }),
      }],
      isError: true,
    };
  }
}

async function handleDownloadBuild(args) {
  try {
    if (!args.build_id) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "error",
            message: "build_id is required. Use list_builds to find available build IDs.",
          }),
        }],
        isError: true,
      };
    }

    const cwd = PROJECT_ROOT;
    let outputPath;
    if (args.output_path) {
      outputPath = resolve(cwd, args.output_path);
    } else {
      outputPath = resolve(cwd, `${args.build_id}.apk`);
    }

    // SECURITY: Prevent path traversal outside the project root
    assertWithinRoot(outputPath, cwd);

    // Ensure the parent directory exists
    const parentDir = dirname(outputPath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    // Download with streaming + SHA-256 verification
    const result = await downloadBuild(args.build_id, outputPath);

    // Validate the downloaded APK (informational)
    const validation = validateApk(outputPath);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "success",
          message: "Build downloaded and verified.",
          build_id: args.build_id,
          output_path: outputPath,
          sha256: result.sha256.substring(0, 16) + "...",
          size_mb: (result.sizeBytes / (1024 * 1024)).toFixed(1),
          apk_valid: validation.valid,
          apk_validation_error: validation.valid ? undefined : sanitizeErrorMessage(validation.error),
        }),
      }],
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ status: "error", message: sanitizeErrorMessage(error.message) }),
      }],
      isError: true,
    };
  }
}

// ================================================================
// Start the server
// ================================================================
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP server error:", error);
  process.exit(1);
});
