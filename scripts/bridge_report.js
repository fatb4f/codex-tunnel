#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const out = {
    in: path.resolve("logs/remote_runs.jsonl"),
    json: path.resolve("logs/remote_behavior_report.json"),
    md: path.resolve("logs/remote_behavior_report.md"),
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

function toMarkdown(report) {
  const lines = [];
  lines.push("# Codex Remote Trigger Behavior Report");
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
  lines.push("## Exit Codes");
  lines.push("");
  for (const [k, v] of Object.entries(report.exit_codes)) {
    lines.push(`- ${k}: \`${v}\``);
  }
  lines.push("");
  lines.push("## Trigger Outcomes");
  lines.push("");
  lines.push(`- timed_out_runs: \`${report.timed_out_runs}\``);
  lines.push(`- failed_runs: \`${report.failed_runs}\``);
  lines.push("");
  lines.push("## Top Project Paths");
  lines.push("");
  for (const item of report.top_project_paths) {
    lines.push(`- \`${item.key}\`: \`${item.count}\``);
  }
  lines.push("");
  lines.push("## Top Project Keys");
  lines.push("");
  for (const item of report.top_project_keys) {
    lines.push(`- \`${item.key}\`: \`${item.count}\``);
  }
  lines.push("");
  lines.push("## Command Distribution");
  lines.push("");
  for (const [k, v] of Object.entries(report.command_distribution)) {
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

  const exitCodeCounts = new Map();
  const projectPathCounts = new Map();
  const projectKeyCounts = new Map();
  const commandCounts = new Map();
  const errorCounts = new Map();
  const outcomeCounts = new Map();
  let timedOutRuns = 0;
  let failedRuns = 0;

  for (const row of rows) {
    const exitCode = Number(row?.result?.exit_code ?? row?.exit_code ?? 1);
    const timedOut = Boolean(row?.result?.timed_out ?? row?.timed_out ?? false);
    const projectPath = row?.project_path ?? "<missing>";
    const projectKey = row?.project_key ?? "<missing>";
    const command = row?.command ?? "<missing>";

    inc(outcomeCounts, row?.kind ?? "unknown");
    inc(exitCodeCounts, String(exitCode));
    inc(projectPathCounts, projectPath);
    inc(projectKeyCounts, projectKey);
    inc(commandCounts, command);

    if (timedOut) {
      timedOutRuns += 1;
      inc(errorCounts, "timed_out");
    }
    if (exitCode !== 0) {
      failedRuns += 1;
      inc(errorCounts, "nonzero_exit");
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    log_source: args.in,
    total_runs: rows.length,
    outcomes: Object.fromEntries([...outcomeCounts.entries()].sort()),
    exit_codes: Object.fromEntries([...exitCodeCounts.entries()].sort()),
    timed_out_runs: timedOutRuns,
    failed_runs: failedRuns,
    top_project_paths: topEntries(projectPathCounts, 20),
    top_project_keys: topEntries(projectKeyCounts, 20),
    command_distribution: Object.fromEntries([...commandCounts.entries()].sort()),
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
