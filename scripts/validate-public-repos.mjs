#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REPOS = [
  "sindresorhus/is",
  "chalk/chalk",
  "expressjs/express",
  "vitejs/vite",
];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const date = new Date().toISOString().slice(0, 10);

function usage() {
  console.log(`Usage: node scripts/validate-public-repos.mjs [options] [owner/repo...]

Options:
  --repo owner/repo       Add a public GitHub repo to validate
  --workdir <path>        Clone repos under this directory
  --report <path>         Write the markdown report to this path
  --keep-workdir          Leave cloned repos in place after the run
  --skip-build            Use the existing dist/ output
  --help                  Show this help

Defaults:
  repos: ${DEFAULT_REPOS.join(", ")}
  workdir: ${join(tmpdir(), "conductor-public-repo-validation")}
  report: <workdir>/report-${date}.md`);
}

function parseArgs(argv) {
  const repos = [];
  let workdir = join(tmpdir(), "conductor-public-repo-validation");
  let report = "";
  let keepWorkdir = false;
  let skipBuild = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else if (arg === "--repo" && argv[i + 1]) {
      repos.push(argv[++i]);
    } else if (arg === "--workdir" && argv[i + 1]) {
      workdir = resolve(argv[++i]);
    } else if (arg === "--report" && argv[i + 1]) {
      report = resolve(argv[++i]);
    } else if (arg === "--keep-workdir") {
      keepWorkdir = true;
    } else if (arg === "--skip-build") {
      skipBuild = true;
    } else if (!arg.startsWith("-")) {
      repos.push(arg);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    repos: repos.length > 0 ? repos : DEFAULT_REPOS,
    workdir,
    report: report || join(workdir, `report-${date}.md`),
    keepWorkdir,
    skipBuild,
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  });

  return {
    ok: !result.error && !result.signal && result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
    signal: result.signal,
  };
}

function requireOk(result, label) {
  if (result.ok) return;
  const details = [
    result.error?.message,
    result.signal ? `signal: ${result.signal}` : "",
    result.stderr.trim(),
    result.stdout.trim(),
  ].filter(Boolean).join("\n");
  throw new Error(`${label} failed\n${details}`);
}

function cloneUrl(repo) {
  if (/^(https?:\/\/|git@)/.test(repo)) return repo;
  return `https://github.com/${repo}.git`;
}

function repoSlug(repo) {
  return repo
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/\.git$/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "__");
}

function gitFiles(repoPath) {
  const result = run("git", ["ls-files"], { cwd: repoPath });
  requireOk(result, "git ls-files");
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

function pickReadme(files) {
  return (
    files.find((file) => /^readme(\.|$)/i.test(basename(file))) ||
    files.find((file) => /(^|\/)readme(\.|$)/i.test(file))
  );
}

function pickSourceOrPackage(files) {
  const preferred = [
    "package.json",
    "src/index.ts",
    "src/index.js",
    "src/main.ts",
    "src/main.js",
    "index.ts",
    "index.js",
    "lib/index.js",
  ];
  return (
    preferred.find((file) => files.includes(file)) ||
    files.find((file) => !/(^|\/)(readme|license|copying|contributing)(\.|$)/i.test(file))
  );
}

function parseJsonOutput(result) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function stageAndCheck({ repoPath, cliPath, file, text, signal }) {
  appendFileSync(join(repoPath, file), text);
  requireOk(run("git", ["add", "--", file], { cwd: repoPath }), `git add ${file}`);
  const check = run(process.execPath, [
    cliPath,
    "check",
    "--project",
    repoPath,
    "--staged",
    "--signals",
    signal,
    "--json",
  ]);
  const parsed = parseJsonOutput(check);
  run("git", ["restore", "--staged", "--", file], { cwd: repoPath });
  run("git", ["restore", "--", file], { cwd: repoPath });
  return { ...check, parsed };
}

function validateRepo(repo, options) {
  const slug = repoSlug(repo);
  const repoPath = join(options.workdir, slug);
  rmSync(repoPath, { recursive: true, force: true });

  console.log(`\nValidating ${repo}`);
  requireOk(run("git", ["clone", "--depth", "1", cloneUrl(repo), repoPath], {
    stdio: ["ignore", "inherit", "inherit"],
  }), `clone ${repo}`);
  run("git", ["config", "user.name", "Conductor Validation"], { cwd: repoPath });
  run("git", ["config", "user.email", "conductor-validation@example.invalid"], { cwd: repoPath });

  const files = gitFiles(repoPath);
  const readme = pickReadme(files);
  const sourceOrPackage = pickSourceOrPackage(files);
  if (!readme) throw new Error(`${repo}: no README file found`);
  if (!sourceOrPackage) throw new Error(`${repo}: no source/package file found`);

  const cliPath = join(repoRoot, "packages/cli/dist/conductor.js");
  const ask = [
    "Update README usage documentation for the package.",
    "Do not change source code, package metadata, build configuration, dependency manifests, or runtime behavior.",
    "Done when the README describes one usage example.",
  ].join(" ");

  const init = run(process.execPath, [cliPath, "init", "--project", repoPath]);
  const extract = run(process.execPath, [cliPath, "extract", "--project", repoPath, "--text", ask]);
  const freeze = run(process.execPath, [
    cliPath,
    "freeze",
    "--project",
    repoPath,
    "--approved-by",
    "validation-harness",
    "--json",
  ]);
  const doctor = run(process.execPath, [cliPath, "doctor", "--project", repoPath, "--json"]);
  const readmeCheck = stageAndCheck({
    repoPath,
    cliPath,
    file: readme,
    text: "\n\nConductor validation probe: README usage documentation.\n",
    signal: "README documentation update",
  });
  const sourceCheck = stageAndCheck({
    repoPath,
    cliPath,
    file: sourceOrPackage,
    text: "\n",
    signal: "changed source code implementation outside README",
  });

  const sourceBlocked =
    sourceCheck.status !== 0 && sourceCheck.parsed?.status === "blocked";
  const readmePassed =
    readmeCheck.status === 0 && readmeCheck.parsed?.status === "ok";
  const extractOk = extract.ok && parseJsonOutput(extract)?.valid === true;
  const freezeOk = freeze.ok && parseJsonOutput(freeze)?.frozen === true;

  return {
    repo,
    readme,
    sourceOrPackage,
    initOk: init.ok,
    extractOk,
    freezeOk,
    doctorOk: doctor.ok,
    doctorStatus: parseJsonOutput(doctor)?.status ?? "unknown",
    readmePassed,
    sourceBlocked,
    errors: [
      init.ok ? "" : "init failed",
      extractOk ? "" : "extract failed",
      freezeOk ? "" : "freeze failed",
      doctor.ok ? "" : "doctor failed",
      readmePassed ? "" : "README control did not pass",
      sourceBlocked ? "" : "source/package control did not block",
    ].filter(Boolean),
  };
}

function mark(value) {
  return value ? "yes" : "no";
}

function renderReport({ commit, results }) {
  const passed = results.filter((result) => result.errors.length === 0).length;
  const lines = [
    `# Public Repo Validation - ${date}`,
    "",
    `**Conductor commit:** \`${commit}\``,
    "**Mode:** local built CLI, public repos cloned into a temporary workdir, no upstream changes.",
    "",
    "## Repos",
    "",
    "| Repo | Init | Extract | Freeze | Doctor | README pass | Source/package block |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];

  for (const result of results) {
    lines.push(
      `| \`${result.repo}\` | ${mark(result.initOk)} | ${mark(result.extractOk)} | ${mark(result.freezeOk)} | ${result.doctorStatus} | ${mark(result.readmePassed)} | ${mark(result.sourceBlocked)} |`,
    );
  }

  lines.push(
    "",
    `Passed \`${passed}/${results.length}\`.`,
    "",
    "## Controls",
    "",
    "- Positive control: staged README-only change against a contract that allows README usage documentation and disallows source/package changes.",
    "- Negative control: staged source/package change with an explicit signal describing implementation drift.",
    "- Setup diagnostic: `conductor doctor --json` runs after freeze and before drift controls.",
    "",
    "## Notes",
    "",
    "- This harness is intentionally manual by default because it clones public repositories.",
    "- Use `--report docs/validation/public-repos/YYYY-MM-DD.md` when the run should be committed.",
    "- Expand the repo list before v1 to cover more layouts, agent-rule files, and path-only drift controls.",
  );

  const failures = results.filter((result) => result.errors.length > 0);
  if (failures.length > 0) {
    lines.push("", "## Failures", "");
    for (const failure of failures) {
      lines.push(`- \`${failure.repo}\`: ${failure.errors.join("; ")}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const cliPath = join(repoRoot, "packages/cli/dist/conductor.js");

  mkdirSync(options.workdir, { recursive: true });
  if (!options.skipBuild || !existsSync(cliPath)) {
    console.log("Building packages before validation...");
    requireOk(run("pnpm", ["build"], { stdio: "inherit" }), "pnpm build");
  }

  const commit = run("git", ["rev-parse", "--short", "HEAD"]).stdout.trim() || "unknown";
  const results = [];
  let failed = false;

  for (const repo of options.repos) {
    try {
      results.push(validateRepo(repo, options));
    } catch (error) {
      failed = true;
      results.push({
        repo,
        readme: "",
        sourceOrPackage: "",
        initOk: false,
        extractOk: false,
        freezeOk: false,
        doctorOk: false,
        doctorStatus: "error",
        readmePassed: false,
        sourceBlocked: false,
        errors: [(error instanceof Error ? error.message : String(error))],
      });
    }
  }

  const report = renderReport({ commit, results });
  mkdirSync(dirname(options.report), { recursive: true });
  writeFileSync(options.report, report);
  console.log(`\nWrote ${options.report}`);

  if (!options.keepWorkdir) {
    rmSync(options.workdir, { recursive: true, force: true });
  }

  const allPassed = results.every((result) => result.errors.length === 0);
  process.exit(allPassed && !failed ? 0 : 1);
}

main();
