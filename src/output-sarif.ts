// The combined report as SARIF 2.1.0.
//
// SARIF is the family's published finding format; the envelope in
// envelope.ts is internal and never leaves this process. The mapping below
// is dep-guard's mapping, applied to all three gates from one place, which
// is the whole point: three hand-written emitters is how a family ends up
// with one tool emitting absolute paths and another omitting fingerprints
// entirely, and both of those really happened here.
//
// The rules, and why each is the way it is:
//
//  - ONE RUN PER GATE. SARIF puts the tool name and version on the run, so
//    a single run cannot honestly describe three tools. Each run's driver
//    name and version come from that gate; a gate whose version could not
//    be read gets no version field rather than a placeholder.
//
//  - A GATE THAT NEVER RAN GETS NO RUN. The tempting alternative is an
//    empty run named for the missing product, which would put that tool's
//    name on something it never did. The umbrella's own findings about it
//    (compass/gate-missing) go into a final run whose driver IS the
//    umbrella, which is the only honest owner of a statement about a tool
//    that is not installed.
//
//  - `properties.blocking` is the gate's decision as reconciled in
//    normalize.ts, never recomputed here from a severity ladder. A second
//    copy of the gate living in the renderer would drift silently, and the
//    report would say "blocking: false" about a finding that had just
//    failed somebody's build.
//
//  - `partialFingerprints` carries the product's own fingerprint, unhashed,
//    under a key that names the product and a version. Hashing it together
//    with anything would mint a second identity for every finding, one that
//    moves when the first does not, and every alert would resurface on the
//    next scan. The key is versioned so a future change to a product's
//    fingerprint inputs ships as "/v2" and a consumer can tell the two
//    apart instead of silently comparing hashes of different things.
//
//  - Paths are RELATIVE, forward-slashed, under `%SRCROOT%`. An absolute
//    path breaks %SRCROOT% resolution on the consumer side and leaks a
//    local directory layout into an artifact that gets uploaded. Both
//    spellings of absolute are stripped: a leading slash and a Windows
//    drive prefix.
//
//  - A REGION ONLY WHEN A REAL POSITION IS KNOWN. One of the three gates
//    reports a line and a column; the other two report no position at all.
//    An invented startLine annotates an unrelated line of somebody's file
//    and is indistinguishable from a true one once uploaded. No endColumn
//    either, for the same reason: the secret scanner's JSON output does not
//    carry the match length, so the end of the match is genuinely unknown
//    from that output.

import type { Finding, Severity } from './envelope.js';
import type { RunResult } from './run.js';

const SARIF_SCHEMA =
  'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json';

export const UMBRELLA_DRIVER_NAME = 'compass';

/**
 * Total over Severity, not a lookup with a fallback: a level added to the
 * union without an entry here is a compile error rather than a result that
 * uploads with no level.
 */
const SARIF_LEVELS: Record<Severity, 'error' | 'warning' | 'note'> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'note',
  info: 'note',
};

/** The partialFingerprints key for a product's own fingerprint. */
export function fingerprintKey(scope: string): string {
  return `${scope}/v1`;
}

function toUri(rawPath: string): string {
  let uri = rawPath.split('\\').join('/');
  // A Windows drive prefix is absolute exactly as a leading slash is.
  // Removed before the slash loop so "C:/x" reduces the whole way rather
  // than to "/x".
  uri = uri.replace(/^[A-Za-z]:\/*/, '');
  while (uri.startsWith('./')) {
    uri = uri.slice(2);
  }
  while (uri.startsWith('/')) {
    uri = uri.slice(1);
  }
  return uri;
}

function artifact(rawPath: string): Record<string, unknown> {
  return { artifactLocation: { uri: toUri(rawPath), uriBaseId: '%SRCROOT%' } };
}

function locationsFor(finding: Finding): Array<Record<string, unknown>> | undefined {
  const subject = finding.subject;
  switch (subject.kind) {
    case 'package':
      // The manifest is a real file, so it gets a physical location, and
      // the package itself is a logical one. No region: no rule in the
      // dependency gate records a line number today, and guessing one would
      // annotate an unrelated line of the user's manifest.
      return [
        {
          physicalLocation: artifact(subject.manifest),
          logicalLocations: [{ kind: 'package', fullyQualifiedName: subject.name }],
        },
      ];
    case 'location': {
      const region: Record<string, number> = {
        startLine: subject.line,
        startColumn: subject.column,
      };
      if (subject.endColumn !== undefined) {
        region.endColumn = subject.endColumn;
      }
      return [{ physicalLocation: { ...artifact(subject.file), region } }];
    }
    case 'paths':
      return subject.paths.map((entry) => ({ physicalLocation: artifact(entry) }));
    case 'contract':
      return [
        {
          logicalLocations: [
            {
              kind: 'contract',
              fullyQualifiedName: subject.category ?? 'intent-contract',
            },
          ],
        },
      ];
    case 'none':
      // No location at all. A missing location is honest; a fabricated one
      // is worse than none and indistinguishable from a true one once the
      // report is uploaded.
      return undefined;
  }
}

function toResult(finding: Finding): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    ruleId: finding.ruleId,
    level: SARIF_LEVELS[finding.severity],
    message: { text: finding.message },
    properties: {
      blocking: finding.blocking,
      severity: finding.severity,
      severityIsDerived: finding.severityIsDerived,
      fingerprintStability: finding.fingerprint?.stability ?? 'none',
      // The details bag verbatim. Not reshaped, not filtered: it is where
      // each gate puts what it actually established.
      details: finding.details,
    },
  };

  if (finding.fingerprint !== null) {
    entry.partialFingerprints = { [fingerprintKey(finding.fingerprint.scope)]: finding.fingerprint.value };
  }

  const locations = locationsFor(finding);
  if (locations !== undefined) {
    entry.locations = locations;
  }

  return entry;
}

function ruleDeclarations(findings: Finding[]): Array<Record<string, unknown>> {
  const ids = [...new Set(findings.map((finding) => finding.ruleId))].sort();
  return ids.map((id) => ({
    id,
    // The bare rule name, with the product namespace removed, so a
    // consumer's rule list reads the way the product's own docs do.
    name: id.slice(id.indexOf('/') + 1),
  }));
}

function makeRun(
  name: string,
  version: string | null,
  findings: Finding[]
): Record<string, unknown> {
  return {
    tool: {
      driver: {
        name,
        // No placeholder version. SARIF makes version optional, and an
        // invented one would be a claim about which build produced the
        // findings.
        ...(version === null ? {} : { version }),
        rules: ruleDeclarations(findings),
      },
    },
    results: findings.map(toResult),
  };
}

/**
 * Renders a whole run as one SARIF log.
 *
 * `umbrellaVersion` names this package's own version, used only for the
 * umbrella's own run. Passed in rather than read from disk so this module
 * stays free of filesystem access.
 */
export function renderSarif(result: RunResult, umbrellaVersion: string): string {
  const runs: Array<Record<string, unknown>> = [];

  for (const gate of result.gates) {
    const own = gate.findings.filter((finding) => finding.product === gate.product);
    // A gate that could not run produced no tool output; the only findings
    // about it belong to the umbrella, and they go in the umbrella's run.
    if (gate.couldNotRun !== null && own.length === 0) {
      continue;
    }
    runs.push(makeRun(gate.product, gate.productVersion, own));
  }

  const umbrellaFindings = result.gates
    .flatMap((gate) => gate.findings)
    .filter((finding) => finding.product === UMBRELLA_DRIVER_NAME);

  if (umbrellaFindings.length > 0) {
    runs.push(makeRun(UMBRELLA_DRIVER_NAME, umbrellaVersion, umbrellaFindings));
  }

  return JSON.stringify({ $schema: SARIF_SCHEMA, version: '2.1.0', runs }, null, 2);
}
