#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const out = {
    in: path.resolve("logs/bridge_runs.jsonl"),
    json: path.resolve("logs/bridge_behavior_report.json"),
    md: path.resolve("logs/bridge_behavior_report.md"),
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--in" && argv[i + 1]) out.in = path.resolve(argv[++i]);
    if (a === "--json" && argv[i + 1]) out.json = path.resolve(argv[++i]);
    if (a === "--md" && argv[i + 1]) out.md = path.resolve(argv[++i]);
  }
  return out;
}

function inc(map, key, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function topEntries(map, limit = 15) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function categorizeCommand(command) {
  const c = command ?? "";
  if (c.includes("/tmp/")) return "tmp";
  if (c.includes("/home/src404/src/xtrl")) return "xtrl_repo";
  if (c.includes("/home/src404/src")) return "src_root";
  if (c.includes("git ")) return "git";
  if (c.includes("pytest")) return "tests";
  return "other";
}

function toMarkdown(report) {
  const lines = [];
  lines.push("# Codex Bridge Behavior Report");
  lines.push("");
  lines.push(`- generated_at: \`${report.generated_at}\``);
  lines.push(`- log_source: \`${report.log_source}\``);
  lines.push(`- total_runs: \`${report.total_runs}\``);
  lines.push("");
  lines.push("## Outcomes");
  lines.push("");
  for (const [k, v] of Object.entries(report.outcomes)) {
    lines.push(`- ${k}: \`${v}\``);
  }
  lines.push("");
  lines.push("## Sandbox Distribution");
  lines.push("");
  for (const [k, v] of Object.entries(report.sandbox_distribution)) {
    lines.push(`- ${k}: \`${v}\``);
  }
  lines.push("");
  lines.push("## Shell Wrapper Prevalence");
  lines.push("");
  lines.push(`- shell_wrapped_commands: \`${report.shell_wrapper.shell_wrapped_commands}\``);
  lines.push(`- total_commands: \`${report.shell_wrapper.total_commands}\``);
  lines.push(`- ratio: \`${report.shell_wrapper.ratio}\``);
  lines.push("");
  lines.push("## Top Commands");
  lines.push("");
  for (const item of report.top_commands) {
    lines.push(`- \`${item.key}\`: \`${item.count}\``);
  }
  lines.push("");
  lines.push("## Path Categories");
  lines.push("");
  for (const [k, v] of Object.entries(report.path_categories)) {
    lines.push(`- ${k}: \`${v}\``);
  }
  lines.push("");
  lines.push("## Error Taxonomy");
  lines.push("");
  for (const [k, v] of Object.entries(report.error_taxonomy)) {
    lines.push(`- ${k}: \`${v}\``);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  let rows = [];
  try {
    const raw = await fs.readFile(args.in, "utf8");
    rows = raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (err) {
    if (err?.code !== "ENOENT") {
      throw err;
    }
  }

  const sandboxCounts = new Map();
  const cmdCounts = new Map();
  const pathCounts = new Map();
  const errorCounts = new Map();
  const outcomeCounts = new Map();
  let shellWrapped = 0;
  let totalCommands = 0;

  for (const row of rows) {
    inc(outcomeCounts, row.status ?? "unknown");
    inc(sandboxCounts, row.sandbox ?? "unset");
    if (row.status === "error") {
      inc(errorCounts, row.error?.type ?? "unknown_error");
      continue;
    }
    const commands = row.telemetry?.commands ?? [];
    if (row.result?.timed_out) {
      inc(errorCounts, "timed_out");
    }
    if (Number(row.result?.exit_code ?? 0) !== 0) {
      inc(errorCounts, "nonzero_exit");
    }
    for (const c of commands) {
      const cmd = c.command ?? "<missing>";
      totalCommands += 1;
      inc(cmdCounts, cmd);
      inc(pathCounts, categorizeCommand(cmd));
      if (/\b(bash|sh|zsh)\s+-c\b/.test(cmd) || /\b(bash|sh|zsh)\s+-lc\b/.test(cmd)) {
        shellWrapped += 1;
      }
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    log_source: args.in,
    total_runs: rows.length,
    outcomes: Object.fromEntries([...outcomeCounts.entries()].sort()),
    sandbox_distribution: Object.fromEntries([...sandboxCounts.entries()].sort()),
    shell_wrapper: {
      shell_wrapped_commands: shellWrapped,
      total_commands: totalCommands,
      ratio: totalCommands ? Number((shellWrapped / totalCommands).toFixed(4)) : 0,
    },
    top_commands: topEntries(cmdCounts, 20),
    path_categories: Object.fromEntries([...pathCounts.entries()].sort()),
    error_taxonomy: Object.fromEntries([...errorCounts.entries()].sort()),
  };

  await fs.mkdir(path.dirname(args.json), { recursive: true });
  await fs.mkdir(path.dirname(args.md), { recursive: true });
  await fs.writeFile(args.json, JSON.stringify(report, null, 2));
  await fs.writeFile(args.md, toMarkdown(report));

  console.log(`wrote ${args.json}`);
  console.log(`wrote ${args.md}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
