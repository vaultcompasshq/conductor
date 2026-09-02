#!/usr/bin/env node
// The umbrella's command-line entry point: two commands, "init" and "run".
//
// Nothing here decides anything. init.ts decides what to write, run.ts
// decides what to run, exit-codes.ts decides the exit code, and this file
// parses arguments and prints. That split is what lets every one of those
// decisions be tested without a subprocess.

import { Command, CommanderError } from 'commander';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
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
import { GATE_ROLES, PolicyError, applyCliOverrides, loadPolicy } from './policy.js';
import type { GateRole } from './policy.js';
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
}

function parseFormat(value: string): 'text' | 'sarif' {
  if (value !== 'text' && value !== 'sarif') {
    throw new PolicyError(`--format must be "text" or "sarif", got "${value}".`);
  }
  return value;
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
    .name('compass')
    .description('One policy file, one hook, and one report over independently installed gates.')
    .version(pkg.version)
    // Without this, commander calls process.exit() itself on any usage
    // problem, which makes the CLI untestable in-process and bypasses the
    // exit-code vocabulary the rest of this tool uses.
    .exitOverride();

  program
    .command('init')
    .description('Write the policy file and one pre-commit hook that runs every enabled gate.')
    .option('--dry-run', 'print every file that would be written or changed, and write nothing')
    .option('--adopt', "replace a gate's own pre-commit hook with the umbrella hook")
    .option('--revert', 'remove exactly what a previous init wrote')
    .option('--json', 'print the result as JSON')
    .exitOverride()
    .action((options: { dryRun?: boolean; adopt?: boolean; revert?: boolean; json?: boolean }) => {
      const cwd = process.cwd();
      const shared = { cwd, pathValue: process.env.PATH ?? '' };

      if (options.revert) {
        const result = revertInit(shared);
        process.stdout.write(
          options.json ? `${JSON.stringify(result)}\n` : `${renderRevertHuman(result)}\n`
        );
        process.exitCode = result.ok ? 0 : EXIT_COULD_NOT_RUN;
        return;
      }

      const initOptions = {
        ...shared,
        ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
        ...(options.adopt === undefined ? {} : { adopt: options.adopt }),
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
    });

  program
    .command('run')
    .description('Run every enabled gate and print one combined report.')
    .option('--staged', 'gate the git index against HEAD, the way the pre-commit hook does')
    .option('--format <format>', 'output format: text or sarif')
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

        const result = runAll(policy, {
          repoRoot: root,
          staged: Boolean(options.staged),
          pathValue: process.env.PATH ?? '',
        });

        process.stdout.write(
          format === 'sarif' ? `${renderSarif(result, pkg.version)}\n` : renderText(result)
        );
        process.exitCode = result.exitCode;
      } catch (err) {
        if (err instanceof PolicyError) {
          process.exitCode = fail(err.message);
          return;
        }
        throw err;
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
    throw err;
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
