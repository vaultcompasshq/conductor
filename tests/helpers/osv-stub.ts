// A stub osv-scanner that tells the head run from the base run, and answers
// per --lockfile argument from the bytes it is handed.
//
// The base run (osv design, section 3.3) hands osv-scanner absolute paths
// under <work directory>/osv-base and runs from that directory; the head run
// hands repository-relative paths from the repository root. The stub records,
// per side, the argv, the working directory, and the exact BYTES of every
// file it was handed with --lockfile (the parse-as prefix requirements.txt:
// removed), so a test can check that the base copy is the base blob and
// nothing else.
//
// What it reports is DERIVED from those bytes, so a test cannot pass by the
// stub saying the expected thing regardless of what it was handed: every line
// of a handed file shaped
//
//     OSV <package> <version> <ecosystem> <advisory id>
//
// (or "#OSV ...", which a requirements file's pin check reads as a comment)
// becomes one package with that advisory, under that file's absolute path,
// and the stub exits 1 when any advisory was reported and 0 otherwise. A side
// can instead be given canned stdout and an exit code (an error, a timeout,
// output that is not JSON); "@CWD@" in canned stdout becomes the working
// directory.

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function which(tool: string): string {
  return execFileSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim();
}

const CP = which('cp');
const SED = which('sed');
const SLEEP = which('sleep');
const MKDIR = which('mkdir');

export interface OsvSide {
  /** Canned stdout instead of the derived answer. */
  stdout?: string;
  /** Exit code; with canned stdout it defaults to 0, otherwise it is derived. */
  exit?: number;
  /** Seconds to sleep before answering, to drive a timeout. */
  sleep?: number;
}

export interface OsvStubOptions {
  head?: OsvSide;
  base?: OsvSide;
  version?: string;
  /** Directory the stub records into; one subdirectory per side. */
  record: string;
}

export interface OsvRecord {
  argv: string[];
  cwd: string[];
  /** Each --lockfile argument as given, with the bytes the stub read from it. */
  lockfiles: Array<{ arg: string; bytes: Buffer }>;
}

/** A lockfile body the derived stub reports these advisories for. */
export function lockBody(
  entries: Array<[name: string, version: string, id: string, ecosystem?: string]>,
  filler = ''
): string {
  return [
    `{"fixture": true${filler === '' ? '' : `, "filler": ${JSON.stringify(filler)}`}}`,
    ...entries.map(([name, version, id, ecosystem]) => `OSV ${name} ${version} ${ecosystem ?? 'npm'} ${id}`),
    '',
  ].join('\n');
}

export function stubOsv(binDir: string, options: OsvStubOptions): string {
  mkdirSync(binDir, { recursive: true });
  mkdirSync(options.record, { recursive: true });
  const file = path.join(binDir, 'osv-scanner');
  const rec = JSON.stringify(options.record);
  const lines = [
    '#!/bin/sh',
    `if [ "$1" = "--version" ]; then echo "osv-scanner version: ${options.version ?? '2.4.0'}"; exit 0; fi`,
    'side=head',
    'for a in "$@"; do case "$a" in */osv-base/*) side=base ;; esac; done',
    `dir=${rec}/$side`,
    `${MKDIR} -p "$dir/bytes"`,
    `printf '%s\\n' "$*" >> "$dir/argv"`,
    'pwd -P >> "$dir/cwd"',
    'n=0',
    'prev=""',
    'out=""',
    'any=0',
    'for a in "$@"; do',
    '  if [ "$prev" = "--lockfile" ]; then',
    '    n=$((n+1))',
    '    f="${a#requirements.txt:}"',
    '    printf \'%s\\n\' "$a" >> "$dir/lockfiles"',
    `    ${CP} "$f" "$dir/bytes/$n" 2>/dev/null || :`,
    '    case "$f" in /*) abs="$f" ;; *) abs="$(pwd)/$f" ;; esac',
    '    pk=""',
    '    if [ -f "$f" ]; then',
    '      while IFS=" " read -r tag name version eco id rest; do',
    '        [ "$tag" = "OSV" ] || [ "$tag" = "#OSV" ] || continue',
    '        e="{\\"package\\":{\\"name\\":\\"$name\\",\\"version\\":\\"$version\\",\\"ecosystem\\":\\"$eco\\"},\\"vulnerabilities\\":[{\\"id\\":\\"$id\\",\\"summary\\":\\"$id in $name\\"}],\\"groups\\":[{\\"ids\\":[\\"$id\\"],\\"aliases\\":[\\"$id\\"],\\"max_severity\\":\\"7.5\\"}]}"',
    '        if [ -z "$pk" ]; then pk="$e"; else pk="$pk,$e"; fi',
    '        any=1',
    '      done < "$f"',
    '    fi',
    '    if [ -n "$pk" ]; then',
    '      r="{\\"source\\":{\\"path\\":\\"$abs\\",\\"type\\":\\"lockfile\\"},\\"packages\\":[$pk]}"',
    '      if [ -z "$out" ]; then out="$r"; else out="$out,$r"; fi',
    '    fi',
    '  fi',
    '  prev="$a"',
    'done',
  ];
  for (const side of ['head', 'base'] as const) {
    const spec = options[side] ?? {};
    lines.push(`if [ "$side" = "${side}" ]; then`);
    if (spec.sleep !== undefined) {
      lines.push(`  ${SLEEP} ${spec.sleep}`);
    }
    if (spec.stdout !== undefined) {
      writeFileSync(`${file}.${side}.stdout`, spec.stdout);
      lines.push(`  ${SED} "s#@CWD@#$(pwd)#g" ${JSON.stringify(`${file}.${side}.stdout`)}`);
      lines.push(`  exit ${spec.exit ?? 0}`);
    } else {
      lines.push(`  printf '{"results":[%s]}\\n' "$out"`);
      lines.push(spec.exit === undefined ? '  exit $any' : `  exit ${spec.exit}`);
    }
    lines.push('fi');
  }
  writeFileSync(file, `${lines.join('\n')}\n`);
  chmodSync(file, 0o755);
  return file;
}

/** What the stub saw on one side; empty when that side never ran. */
export function osvRecord(record: string, side: 'head' | 'base'): OsvRecord {
  const dir = path.join(record, side);
  if (!existsSync(dir)) {
    return { argv: [], cwd: [], lockfiles: [] };
  }
  const lines = (name: string): string[] =>
    existsSync(path.join(dir, name))
      ? readFileSync(path.join(dir, name), 'utf8').split('\n').filter((line) => line !== '')
      : [];
  const args = lines('lockfiles');
  const bytesDir = path.join(dir, 'bytes');
  const stored = existsSync(bytesDir) ? readdirSync(bytesDir) : [];
  return {
    argv: lines('argv'),
    cwd: lines('cwd'),
    lockfiles: args.map((arg, i) => ({
      arg,
      bytes: stored.includes(String(i + 1)) ? readFileSync(path.join(bytesDir, String(i + 1))) : Buffer.alloc(0),
    })),
  };
}

/**
 * One canned osv-scanner result for a lockfile, at a path under @CWD@, with
 * packages carrying the given advisories. Shaped like the 2.4.0 output.
 */
export function osvResult(
  lockfile: string,
  packages: Array<{ name: string; version: string; ecosystem?: string; ids: string[]; extra?: Record<string, unknown> }>
): Record<string, unknown> {
  return {
    source: { path: `@CWD@/${lockfile}`, type: 'lockfile' },
    packages: packages.map((pkg) => ({
      package: { name: pkg.name, version: pkg.version, ecosystem: pkg.ecosystem ?? 'npm' },
      ...(pkg.ids.length === 0
        ? {}
        : {
            vulnerabilities: pkg.ids.map((id) => ({ id, summary: `${id} in ${pkg.name}` })),
            groups: pkg.ids.map((id) => ({ ids: [id], aliases: [id], max_severity: '7.5' })),
          }),
      ...(pkg.extra ?? {}),
    })),
  };
}

/** A whole canned osv-scanner stdout from results. */
export function osvOutput(...results: Array<Record<string, unknown>>): string {
  return JSON.stringify({ results });
}
