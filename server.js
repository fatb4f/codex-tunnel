import { createServer } from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const HOST = process.env.REMOTE_HOST ?? process.env.MCP_HOST ?? "127.0.0.1";
const PORT = Number(process.env.REMOTE_PORT ?? process.env.MCP_PORT ?? process.env.PORT ?? 8000);
const OUTPUT_MAX_BYTES = Number(process.env.REMOTE_OUTPUT_MAX_BYTES ?? process.env.BRIDGE_OUTPUT_MAX_BYTES ?? 20000);
const REMOTE_ACCESS_TOKEN = process.env.REMOTE_ACCESS_TOKEN ?? "";
const REMOTE_PROJECT_ROOT = path.resolve(process.env.REMOTE_PROJECT_ROOT ?? process.cwd());
const REMOTE_RESUME_COMMAND = process.env.REMOTE_RESUME_COMMAND ?? "/home/src404/.local/bin/xx.sh";
const REMOTE_TRIGGER_TIMEOUT_MS = Number(process.env.REMOTE_TRIGGER_TIMEOUT_MS ?? 30000);
const REMOTE_RUN_LOG_PATH = path.resolve(process.env.REMOTE_RUN_LOG_PATH ?? path.join(process.cwd(), "logs", "remote_runs.jsonl"));
const REMOTE_DEBUG = /^(1|true|yes)$/i.test(process.env.REMOTE_DEBUG ?? process.env.BRIDGE_DEBUG ?? "0");

function log(...args) {
  if (REMOTE_DEBUG) {
    console.log("[codex-remote]", ...args);
  }
}

function clampText(value, maxBytes) {
  const buf = Buffer.from(value ?? "", "utf8");
  if (buf.length <= maxBytes) return { text: value ?? "", truncated: false, bytes: buf.length };
  return {
    text: buf.subarray(buf.length - maxBytes).toString("utf8"),
    truncated: true,
    bytes: buf.length,
  };
}

function redactSecrets(value) {
  if (!value) return "";
  return value
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED_KEY]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED_TOKEN]")
    .replace(/(OPENAI_API_KEY\s*=\s*)\S+/g, "$1[REDACTED]");
}

function assertProjectPathAllowed(projectPath) {
  const resolved = path.resolve(projectPath);
  if (resolved !== REMOTE_PROJECT_ROOT && !resolved.startsWith(REMOTE_PROJECT_ROOT + path.sep)) {
    throw new Error(`project_path outside REMOTE_PROJECT_ROOT: ${resolved}`);
  }
  return resolved;
}

function requireBearerAuth(req) {
  if (!REMOTE_ACCESS_TOKEN) return;
  const auth = req.headers.authorization ?? "";
  const expected = `Bearer ${REMOTE_ACCESS_TOKEN}`;
  if (auth !== expected) {
    const err = new Error("Unauthorized");
    err.statusCode = 401;
    throw err;
  }
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk.toString("utf8");
    if (body.length > 1_000_000) throw new Error("Request body too large");
  }
  if (!body.trim()) return {};
  return JSON.parse(body);
}

async function appendRemoteRunLog(entry) {
  await fs.mkdir(path.dirname(REMOTE_RUN_LOG_PATH), { recursive: true });
  await fs.appendFile(REMOTE_RUN_LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8");
}

async function runRemoteResume({ projectPath, projectKey, extraArgs }) {
  const safeProjectPath = assertProjectPathAllowed(projectPath);
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  const args = [];
  if (projectKey) args.push(String(projectKey));
  args.push(safeProjectPath);
  if (Array.isArray(extraArgs)) {
    for (const arg of extraArgs) {
      if (typeof arg === "string" && arg.length > 0) args.push(arg);
    }
  }

  log("resume spawn", { command: REMOTE_RESUME_COMMAND, args, cwd: safeProjectPath });

  const child = spawn(REMOTE_RESUME_COMMAND, args, {
    cwd: safeProjectPath,
    env: {
      ...process.env,
      CODEX_PROJECT_PATH: safeProjectPath,
      CODEX_PROJECT_KEY: projectKey ? String(projectKey) : "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, REMOTE_TRIGGER_TIMEOUT_MS);

  child.stdout.on("data", (d) => {
    stdout += d.toString("utf8");
  });
  child.stderr.on("data", (d) => {
    stderr += d.toString("utf8");
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  }).finally(() => clearTimeout(timer));

  const stdoutClamped = clampText(stdout, OUTPUT_MAX_BYTES);
  const stderrClamped = clampText(stderr, OUTPUT_MAX_BYTES);
  const durationMs = Date.now() - startedAt;

  await appendRemoteRunLog({
    kind: "remote_resume_run",
    request_id: requestId,
    timestamp: new Date(startedAt).toISOString(),
    duration_ms: durationMs,
    project_path: safeProjectPath,
    project_key: projectKey ?? null,
    command: REMOTE_RESUME_COMMAND,
    args,
    result: {
      exit_code: Number(exitCode ?? 1),
      timed_out: timedOut,
    },
    output: {
      stdout_tail: redactSecrets(stdoutClamped.text),
      stderr_tail: redactSecrets(stderrClamped.text),
      truncation: {
        stdout: stdoutClamped.truncated,
        stderr: stderrClamped.truncated,
      },
    },
  });

  return {
    requestId,
    projectPath: safeProjectPath,
    projectKey: projectKey ?? null,
    exitCode: Number(exitCode ?? 1),
    timedOut,
    durationMs,
    stdoutTail: redactSecrets(stdoutClamped.text),
    stderrTail: redactSecrets(stderrClamped.text),
  };
}

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Missing URL" }));
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const normalizedPath = url.pathname.endsWith("/") && url.pathname.length > 1
    ? url.pathname.slice(0, -1)
    : url.pathname;

  if (req.method === "GET" && normalizedPath === "/") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Codex remote access bridge OK");
    return;
  }

  if (req.method === "GET" && normalizedPath === "/remote/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "codex-remote-bridge",
        remote_project_root: REMOTE_PROJECT_ROOT,
      }),
    );
    return;
  }

  if (req.method === "POST" && normalizedPath === "/remote/resume") {
    try {
      requireBearerAuth(req);
      const body = await readJsonBody(req);
      const projectPath = body.project_path ?? body.cwd;
      if (typeof projectPath !== "string" || !projectPath.trim()) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "project_path is required" }));
        return;
      }
      const result = await runRemoteResume({
        projectPath: projectPath.trim(),
        projectKey: typeof body.project_key === "string" ? body.project_key.trim() : undefined,
        extraArgs: Array.isArray(body.extra_args) ? body.extra_args : [],
      });
      const ok = result.exitCode === 0 && !result.timedOut;
      res.writeHead(ok ? 200 : 500, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok,
          request_id: result.requestId,
          project_path: result.projectPath,
          project_key: result.projectKey,
          exit_code: result.exitCode,
          timed_out: result.timedOut,
          duration_ms: result.durationMs,
          stdout_tail: result.stdoutTail,
          stderr_tail: result.stderrTail,
        }),
      );
      return;
    } catch (err) {
      const statusCode = Number(err?.statusCode ?? 500);
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(statusCode, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: redactSecrets(message) }));
      return;
    }
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "Not Found" }));
});

httpServer.listen(PORT, HOST, () => {
  console.log(`Codex remote bridge listening on http://${HOST}:${PORT}`);
  console.log(`Remote health endpoint: http://${HOST}:${PORT}/remote/health`);
  console.log(`Remote resume endpoint: http://${HOST}:${PORT}/remote/resume`);
  console.log(`REMOTE_PROJECT_ROOT=${REMOTE_PROJECT_ROOT}`);
});
