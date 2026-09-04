#!/usr/bin/env node
// The umbrella's command-line entry point: two commands, "init" and "run".
//
// Nothing here decides anything. init.ts decides what to write, run.ts
// decides what to run, exit-codes.ts decides the exit code, and this file
// parses arguments and prints. That split is what lets every one of those
// decisions be tested without a subprocess.

import { Command, CommanderError } from 'commander';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXIT_COULD_NOT_RUN } from './exit-codes.js';
import {
  applyInit,
  planInit,
  renderInitHuman,
  renderRevertHuman,
  revertInit,
} from './init.js';
import { renderSarif } from './output-sarif.js';
import { renderText } from './output-text.js';
import { GATE_ROLES, GATE_STAGES, PolicyError, applyCliOverrides, loadPolicy } from './policy.js';
import type { GateRole, GateStage } from './policy.js';
import { runAll } from './run.js';

const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };

function repoRoot(cwd: string): string {
  // The policy file, the hook, and every child's working directory are all
  // anchored at the working-tree root, so a run from a subdirectory behaves
  // exactly like a run from the top.
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return cwd;
  }
}

interface RunCliOptions {
  staged?: boolean;
  format: string;
  gate?: string[];
  stage?: string;
  base?: string;
  spec?: string;
  output?: string;
  verbose?: boolean;
}

function parseFormat(value: string): 'text' | 'sarif' {
  if (value !== 'text' && value !== 'sarif') {
    throw new PolicyError(`--format must be "text" or "sarif", got "${value}".`);
  }
  return value;
}

/**
 * An unknown stage is a usage error, never a silent full run.
 *
 * The dangerous failure here is the quiet one. A typo in a CI file that
 * makes the job run every gate reads as a passing build with more coverage
 * than it has, and a typo that makes it run none reads as a passing build
 * with no coverage at all. Both look like success.
 */
function parseStage(value: string | undefined): GateStage | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!(GATE_STAGES as readonly string[]).includes(value)) {
    throw new PolicyError(`--stage must be one of ${GATE_STAGES.join(', ')}, got "${value}".`);
  }
  return value as GateStage;
}

function parseRoles(values: string[] | undefined): GateRole[] | undefined {
  if (values === undefined) {
    return undefined;
  }
  for (const value of values) {
    if (!(GATE_ROLES as readonly string[]).includes(value)) {
      throw new PolicyError(`--gate must be one of ${GATE_ROLES.join(', ')}, got "${value}".`);
    }
  }
  return values as GateRole[];
}

function fail(message: string): number {
  process.stderr.write(`${message}\n`);
  return EXIT_COULD_NOT_RUN;
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('conductor')
    .description('One policy file, one hook, and one report over independently installed gates.')
    .version(pkg.version)
    // Without this, commander calls process.exit() itself on any usage
    // problem, which makes the CLI untestable in-process and bypasses the
    // exit-code vocabulary the rest of this tool uses.
    .exitOverride();

  program
    .command('init')
    .description(
      'Write the policy file and one pre-commit hook that runs the commit-stage gates.'
    )
    .option('--dry-run', 'print every file that would be written or changed, and write nothing')
    .option('--adopt', "replace a gate's own pre-commit hook with the umbrella hook")
    .option('--revert', 'remove exactly what a previous init wrote')
    .option(
      '--force',
      'act on a file that has changed since init wrote it: replace a managed hook somebody has edited, or with --revert remove one and restore any adopted hook'
    )
    .option('--json', 'print the result as JSON')
    .exitOverride()
    .action(
      (options: {
        dryRun?: boolean;
        adopt?: boolean;
        revert?: boolean;
        force?: boolean;
        json?: boolean;
      }) => {
        const cwd = process.cwd();
        const shared = { cwd, pathValue: process.env.PATH ?? '' };

        if (options.revert) {
          const result = revertInit({ ...shared, force: Boolean(options.force) });
          const rendered = `${renderRevertHuman(result)}\n`;
          if (options.json) {
            process.stdout.write(`${JSON.stringify(result)}\n`);
          } else if (result.ok) {
            process.stdout.write(rendered);
          } else {
            // A partial revert left something behind, so it is not success
            // output. Writing it to stdout would let a script pipe it past a
            // reader who needed to see it.
            process.stderr.write(rendered);
          }
          process.exitCode = result.ok ? 0 : EXIT_COULD_NOT_RUN;
          return;
        }

        const initOptions = {
          ...shared,
          ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
          ...(options.adopt === undefined ? {} : { adopt: options.adopt }),
          ...(options.force === undefined ? {} : { force: options.force }),
        };
        const result = applyInit(planInit(initOptions), initOptions);

        if (options.json) {
          process.stdout.write(`${JSON.stringify(result)}\n`);
        } else if (result.ok) {
          process.stdout.write(`${renderInitHuman(result)}\n`);
        } else {
          process.stderr.write(`${renderInitHuman(result)}\n`);
        }
        process.exitCode = result.ok ? 0 : EXIT_COULD_NOT_RUN;
      }
    );

  program
    .command('run')
    .description('Run every enabled gate and print one combined report.')
    .option('--staged', 'gate the git index against HEAD, the way the pre-commit hook does')
    .option('--format <format>', 'output format: text or sarif')
    .option(
      '--stage <stage>',
      `which stopping point this run is: ${GATE_STAGES.join(', ')}. Stages are cumulative, so a gate runs at its own stage and every later one. Omit it to run every enabled gate.`
    )
    .option(
      '--base <ref>',
      'measure the intent gate against what this branch changed since <ref>, rather than against the index. In Actions this defaults to origin/<GITHUB_BASE_REF> when it is set.'
    )
    .option(
      '--output <path>',
      'write the report to this file instead of to stdout, for a CI step that uploads it'
    )
    .option(
      '--spec <path>',
      'the spec the intent gate imports its contract from, outranking a Spec: line in the pull request body and the branch-name convention'
    )
    .option(
      '--verbose',
      'print the full per-gate report even when the run is clean. A clean run prints one summary line by default, because a pre-commit hook that prints a screenful on every commit is a hook a team switches off. Text output only; SARIF is unaffected.'
    )
    .option(
      '--gate <role>',
      'restrict the run to this role; repeatable',
      (value: string, previous: string[] = []) => [...previous, value]
    )
    .exitOverride()
    .action((options: RunCliOptions) => {
      const cwd = process.cwd();
      const root = repoRoot(cwd);

      try {
        const policy = applyCliOverrides(loadPolicy(root), {
          ...(parseRoles(options.gate) === undefined
            ? {}
            : { gates: parseRoles(options.gate) as GateRole[] }),
        });
        const format = parseFormat(options.format ?? policy.report.format);
        const stage = parseStage(options.stage);

        const result = runAll(policy, {
          repoRoot: root,
          staged: Boolean(options.staged),
          pathValue: process.env.PATH ?? '',
          env: process.env,
          ...(stage === undefined ? {} : { stage }),
          ...(options.base === undefined ? {} : { base: options.base }),
          ...(options.spec === undefined ? {} : { spec: options.spec }),
        });

        const rendered =
          format === 'sarif'
            ? `${renderSarif(result, pkg.version)}\n`
            : renderText(result, { verbose: Boolean(options.verbose) });

        if (options.output === undefined) {
          process.stdout.write(rendered);
        } else {
          // A failure to write is the umbrella not carrying out what it was
          // asked, so it takes the could-not-run code rather than the run's
          // own. Reporting exit 0 next to a report nobody can read is the
          // worst of the available answers: the upload step downstream would
          // fail on a missing file with no explanation here.
          writeFileSync(options.output, rendered);
          // One line, so a CI job whose only product is an uploaded artifact
          // does not read as a job that did nothing.
          process.stdout.write(
            `conductor run: ${result.gates.length} gate(s), ${result.findings.length} finding(s); ` +
              `${format} report written to ${options.output}\n`
          );
        }
        process.exitCode = result.exitCode;
      } catch (err) {
        // One line, never a stack. runGate is total, so nothing from a gate
        // reaches here; anything that does is the umbrella's own problem and
        // still must not put a local filesystem path in front of a user who
        // cannot act on it, or into a pre-commit hook's output.
        process.exitCode = fail(
          err instanceof PolicyError
            ? err.message
            : `conductor: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    });

  return program;
}

async function main(): Promise<void> {
  try {
    await buildProgram().parseAsync(process.argv);
  } catch (err) {
    if (err instanceof CommanderError) {
      // --help and --version already printed what they needed and carry
      // exitCode 0. Everything else is a bad command line, which is the
      // umbrella's "could not carry out what it was asked".
      process.exitCode = err.exitCode === 0 ? 0 : EXIT_COULD_NOT_RUN;
      return;
    }
    // The last backstop. Still one line, still no stack: an unhandled throw
    // printing a stack into a pre-commit hook's output is how a local path
    // ends up pasted into an issue.
    process.exitCode = fail(`conductor: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// realpath both sides before comparing: on macOS the OS temp directory and
// other mount points resolve through a symlink, so import.meta.url reports
// the resolved path while process.argv[1] reports whatever the caller
// typed, and a naive comparison can silently skip main() entirely.
function isMainModule(): boolean {
  if (process.argv[1] === undefined) {
    return false;
  }
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  void main();
}
