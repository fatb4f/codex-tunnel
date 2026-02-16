import { createServer } from "node:http";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const WORKSPACE_ROOT = path.resolve(process.env.CODEX_WORKSPACE_ROOT ?? process.cwd());
const HOST = process.env.MCP_HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? process.env.MCP_PORT ?? 8000);
const MCP_PATH = process.env.MCP_PATH ?? "/mcp";
const CODEX_TIMEOUT_MS = Number(process.env.CODEX_TIMEOUT_MS ?? 180000);
const OUTPUT_MAX_BYTES = Number(process.env.BRIDGE_OUTPUT_MAX_BYTES ?? 20000);
const RUN_LOG_PATH = path.resolve(process.env.BRIDGE_RUN_LOG_PATH ?? path.join(process.cwd(), "logs", "bridge_runs.jsonl"));
const BRIDGE_DEBUG = /^(1|true|yes)$/i.test(process.env.BRIDGE_DEBUG ?? "0");

function log(...args) {
  if (BRIDGE_DEBUG) {
    console.log("[codex-bridge]", ...args);
  }
}

function assertCwdAllowed(cwd) {
  const resolved = path.resolve(cwd);
  if (resolved !== WORKSPACE_ROOT && !resolved.startsWith(WORKSPACE_ROOT + path.sep)) {
    throw new Error(`cwd outside CODEX_WORKSPACE_ROOT: ${resolved}`);
  }
  return resolved;
}

function clampText(value, maxBytes) {
  const buf = Buffer.from(value ?? "", "utf8");
  if (buf.length <= maxBytes) {
    return { text: value ?? "", truncated: false, bytes: buf.length };
  }
  return {
    text: buf.subarray(buf.length - maxBytes).toString("utf8"),
    truncated: true,
    bytes: buf.length,
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function redactSecrets(value) {
  if (!value) return "";
  return value
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED_KEY]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED_TOKEN]")
    .replace(/(OPENAI_API_KEY\s*=\s*)\S+/g, "$1[REDACTED]");
}

function extractJsonObjects(value) {
  const out = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === "}") {
      if (depth > 0) depth -= 1;
      if (depth === 0 && start >= 0) {
        const slice = value.slice(start, i + 1);
        try {
          out.push(JSON.parse(slice));
        } catch {
          // Ignore invalid chunks.
        }
        start = -1;
      }
    }
  }
  return out;
}

function extractTelemetry(stdout) {
  const events = extractJsonObjects(stdout);
  const commands = [];
  let usage = null;
  for (const event of events) {
    if (event?.type === "item.started" || event?.type === "item.completed") {
      const item = event.item;
      if (item?.type === "command_execution") {
        commands.push({
          command: item.command ?? null,
          exit_code: Number.isFinite(item.exit_code) ? item.exit_code : null,
          status: item.status ?? null,
        });
      }
    }
    if (event?.type === "turn.completed" && event?.usage) {
      usage = event.usage;
    }
  }
  return { commands, usage };
}

async function appendRunLog(entry) {
  await fs.mkdir(path.dirname(RUN_LOG_PATH), { recursive: true });
  await fs.appendFile(RUN_LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8");
}

async function runCodexExec({ cwd, prompt, model, sandbox, fullAuto }) {
  const safeCwd = assertCwdAllowed(cwd);
  const outFile = path.join(os.tmpdir(), `codex-last-message-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);

  const codexCmd = process.env.CODEX_COMMAND ?? "codex";
  const codexArgs = [
    "exec",
    "--sandbox",
    sandbox,
    "--output-last-message",
    outFile,
    "--json",
  ];

  if (fullAuto) codexArgs.push("--full-auto");
  if (model) codexArgs.push("--model", model);
  codexArgs.push("-");

  log("spawn", { codexCmd, codexArgs, safeCwd });

  const child = spawn(codexCmd, codexArgs, {
    cwd: safeCwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, CODEX_TIMEOUT_MS);

  child.stdout.on("data", (d) => {
    stdout += d.toString("utf8");
  });
  child.stderr.on("data", (d) => {
    stderr += d.toString("utf8");
  });

  child.stdin.write(prompt);
  child.stdin.end();

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  }).finally(() => clearTimeout(timer));

  let lastMessage = "";
  try {
    lastMessage = await fs.readFile(outFile, "utf8");
  } catch {
    // Ignore if output file wasn't written.
  }
  try {
    await fs.unlink(outFile);
  } catch {
    // Ignore cleanup errors.
  }

  const stdoutClamped = clampText(stdout, OUTPUT_MAX_BYTES);
  const stderrClamped = clampText(stderr, OUTPUT_MAX_BYTES);
  const lastMessageClamped = clampText(lastMessage, OUTPUT_MAX_BYTES);
  const telemetry = extractTelemetry(stdout);

  return {
    exitCode: Number(exitCode ?? 1),
    timedOut,
    cwd: safeCwd,
    sandbox,
    fullAuto,
    model: model ?? null,
    lastMessage: lastMessageClamped.text,
    stdoutTail: stdoutClamped.text,
    stderrTail: stderrClamped.text,
    truncation: {
      stdout: stdoutClamped.truncated,
      stderr: stderrClamped.truncated,
      lastMessage: lastMessageClamped.truncated,
    },
    telemetry,
  };
}

function createCodexServer() {
  const server = new McpServer({ name: "codex-cli-bridge", version: "0.2.0" });

  server.registerTool(
    "codex_exec",
    {
      title: "Run Codex CLI (non-interactive)",
      description: "Run codex exec in an allowed workspace path and return structured output.",
      inputSchema: {
        cwd: z.string().min(1).max(512),
        prompt: z.string().min(1).max(12000),
        model: z.string().max(128).optional(),
        sandbox: z.enum(["read-only", "workspace-write", "danger-full-access"]).optional(),
        fullAuto: z.boolean().optional(),
      },
    },
    async (args) => {
      const requestId = crypto.randomUUID();
      const startedAt = Date.now();
      const envelope = {
        request_id: requestId,
        timestamp: new Date(startedAt).toISOString(),
        cwd: args.cwd,
        sandbox: args.sandbox ?? "read-only",
        full_auto: args.fullAuto ?? false,
        model: args.model ?? null,
        prompt_sha256: sha256(args.prompt),
        prompt_bytes: Buffer.byteLength(args.prompt, "utf8"),
      };
      let result;
      try {
        result = await runCodexExec({
          cwd: args.cwd,
          prompt: args.prompt,
          model: args.model,
          sandbox: args.sandbox ?? "read-only",
          fullAuto: args.fullAuto ?? false,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await appendRunLog({
          kind: "codex_exec_run",
          status: "error",
          ...envelope,
          duration_ms: Date.now() - startedAt,
          error: {
            type: err?.name ?? "Error",
            message: redactSecrets(message),
          },
        });
        throw err;
      }

      await appendRunLog({
        kind: "codex_exec_run",
        status: "completed",
        ...envelope,
        duration_ms: Date.now() - startedAt,
        result: {
          exit_code: result.exitCode,
          timed_out: result.timedOut,
        },
        telemetry: {
          commands: result.telemetry.commands,
          usage: result.telemetry.usage,
        },
        output: {
          last_message_tail: redactSecrets(result.lastMessage),
          stdout_tail: redactSecrets(result.stdoutTail),
          stderr_tail: redactSecrets(result.stderrTail),
          truncation: result.truncation,
        },
      });

      const text = [
        `requestId: ${requestId}`,
        `exitCode: ${result.exitCode}`,
        `timedOut: ${result.timedOut}`,
        `cwd: ${result.cwd}`,
        `sandbox: ${result.sandbox}`,
        `fullAuto: ${result.fullAuto}`,
        "",
        "--- Codex final message ---",
        result.lastMessage,
        "",
        "--- codex stdout tail ---",
        result.stdoutTail,
        "",
        "--- codex stderr tail ---",
        result.stderrTail,
      ].join("\n");

      return {
        content: [{ type: "text", text }],
        structuredContent: {
          ...result,
          requestId,
        },
      };
    }
  );

  return server;
}

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const normalizedPath = url.pathname.endsWith("/") && url.pathname.length > 1
    ? url.pathname.slice(0, -1)
    : url.pathname;

  if (req.method === "OPTIONS" && normalizedPath === MCP_PATH) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && normalizedPath === "/") {
    res.writeHead(200, { "content-type": "text/plain" }).end("Codex MCP bridge OK");
    return;
  }

  const allowedMethods = new Set(["POST", "GET", "DELETE"]);
  if (normalizedPath === MCP_PATH && req.method && allowedMethods.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const server = createCodexServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      log("request error", err);
      if (!res.headersSent) {
        res.writeHead(500).end("Internal server error");
      }
    }
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(PORT, HOST, () => {
  console.log(`Codex MCP bridge listening on http://${HOST}:${PORT}${MCP_PATH}`);
  console.log(`CODEX_WORKSPACE_ROOT=${WORKSPACE_ROOT}`);
});
