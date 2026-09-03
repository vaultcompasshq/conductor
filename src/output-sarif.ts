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
//    (conductor/gate-missing) go into a final run whose driver IS the
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
//  - A PATH IS ONLY PUT UNDER `%SRCROOT%` WHEN IT IS ACTUALLY UNDER IT.
//    A uri with `%SRCROOT%` on it is a claim that the file sits inside the
//    scanned source root, and a consumer resolves it that way. Two kinds of
//    path are not:
//
//      An ABSOLUTE path. One of the gates keeps a path absolute exactly when
//      the file is outside the directory it scanned, so an absolute path is
//      positive evidence the file is NOT under the source root. Stripping
//      the leading slash off it, which is what this file used to do, does
//      not make it relative to anything: it fabricates a source-root-
//      relative path that points at a different file, or at no file, and
//      %SRCROOT% then vouches for it. Those get a `file:` uri and no
//      uriBaseId, which is the spec's own way of saying "elsewhere".
//
//      A path that still contains a `..` segment after normalizing. It
//      escapes the root and cannot be resolved without knowing where the
//      root is, so the physical location is DROPPED and the raw path is kept
//      in the properties bag instead. No location is honest; a wrong one is
//      not, and is indistinguishable from a right one once uploaded.
//
//    Everything genuinely inside keeps the relative, forward-slashed,
//    `%SRCROOT%`-based spelling that GitHub code scanning wants.
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

export const UMBRELLA_DRIVER_NAME = 'conductor';

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

/** Both spellings of absolute: a leading slash, and a Windows drive prefix. */
function isAbsolutePath(forwardSlashed: string): boolean {
  return forwardSlashed.startsWith('/') || /^[A-Za-z]:\//.test(forwardSlashed);
}

export type ArtifactPlacement =
  /** Inside the source root: relative uri under %SRCROOT%. */
  | { placement: 'in-root'; uri: string }
  /** Known to be elsewhere: an absolute file uri with no uriBaseId. */
  | { placement: 'outside-root'; uri: string }
  /** Unresolvable from here: no physical location at all. */
  | { placement: 'unresolvable' };

/**
 * Decides how one path can honestly be named in SARIF.
 *
 * Exported so the rules above can be tested directly rather than only
 * through a whole rendered log.
 */
export function placeArtifact(rawPath: string): ArtifactPlacement {
  const forwardSlashed = rawPath.split('\\').join('/');

  if (isAbsolutePath(forwardSlashed)) {
    // Encode each segment, keeping the separators. A path can legitimately
    // contain a space or a hash, and neither is legal raw in a uri.
    const encoded = forwardSlashed
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return {
      placement: 'outside-root',
      uri: forwardSlashed.startsWith('/') ? `file://${encoded}` : `file:///${encoded}`,
    };
  }

  let uri = forwardSlashed;
  while (uri.startsWith('./')) {
    uri = uri.slice(2);
  }

  // A ".." segment escapes the root. Not "starts with", because "a/../../b"
  // escapes too and only the second one is visible after normalizing.
  const segments = uri.split('/').filter((segment) => segment !== '.' && segment !== '');
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment !== '..') {
      resolved.push(segment);
      continue;
    }
    if (resolved.length === 0) {
      return { placement: 'unresolvable' };
    }
    resolved.pop();
  }
  if (resolved.length === 0) {
    return { placement: 'unresolvable' };
  }

  return { placement: 'in-root', uri: resolved.join('/') };
}

function artifact(rawPath: string): Record<string, unknown> | null {
  const placed = placeArtifact(rawPath);
  switch (placed.placement) {
    case 'in-root':
      return { artifactLocation: { uri: placed.uri, uriBaseId: '%SRCROOT%' } };
    case 'outside-root':
      // No uriBaseId. Attaching %SRCROOT% to an absolute uri is a claim the
      // file is inside the scanned root when the gate said the opposite.
      return { artifactLocation: { uri: placed.uri } };
    case 'unresolvable':
      return null;
  }
}

/** Paths this finding named that could not be placed honestly. */
function unplaceablePaths(finding: Finding): string[] {
  const subject = finding.subject;
  const paths =
    subject.kind === 'package'
      ? [subject.manifest]
      : subject.kind === 'location'
        ? [subject.file]
        : subject.kind === 'paths'
          ? subject.paths
          : [];
  return paths.filter((entry) => placeArtifact(entry).placement === 'unresolvable');
}

function locationsFor(finding: Finding): Array<Record<string, unknown>> | undefined {
  const subject = finding.subject;
  switch (subject.kind) {
    case 'package': {
      // The manifest is a real file, so it gets a physical location, and
      // the package itself is a logical one. No region: no rule in the
      // dependency gate records a line number today, and guessing one would
      // annotate an unrelated line of the user's manifest.
      const logicalLocations = [{ kind: 'package', fullyQualifiedName: subject.name }];
      const physicalLocation = artifact(subject.manifest);
      // The package is still worth naming even when its manifest cannot be
      // placed, so the logical location survives on its own.
      return [physicalLocation === null ? { logicalLocations } : { physicalLocation, logicalLocations }];
    }
    case 'location': {
      const physicalLocation = artifact(subject.file);
      if (physicalLocation === null) {
        return undefined;
      }
      const region: Record<string, number> = {
        startLine: subject.line,
        startColumn: subject.column,
      };
      if (subject.endColumn !== undefined) {
        region.endColumn = subject.endColumn;
      }
      return [{ physicalLocation: { ...physicalLocation, region } }];
    }
    case 'paths': {
      const placed = subject.paths
        .map((entry) => artifact(entry))
        .filter((entry): entry is Record<string, unknown> => entry !== null)
        .map((physicalLocation) => ({ physicalLocation }));
      return placed.length === 0 ? undefined : placed;
    }
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
  // A path that escapes the source root gets no physical location, so the
  // path itself is carried here instead. Dropping a location is honest;
  // dropping the information as well would just lose the finding's subject.
  const unplaceable = unplaceablePaths(finding);

  const entry: Record<string, unknown> = {
    ruleId: finding.ruleId,
    level: SARIF_LEVELS[finding.severity],
    message: { text: finding.message },
    properties: {
      blocking: finding.blocking,
      severity: finding.severity,
      severityIsDerived: finding.severityIsDerived,
      fingerprintStability: finding.fingerprint?.stability ?? 'none',
      ...(unplaceable.length === 0 ? {} : { unresolvablePaths: unplaceable }),
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
  findings: Finding[],
  properties?: Record<string, unknown>
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
    ...(properties === undefined ? {} : { properties }),
  };
}

/**
 * The umbrella's own diagnostics, as SARIF results.
 *
 * These are not findings about the code, so they are note level, do not
 * block, and carry no location. They still belong in the published log: a
 * blocking-count mismatch means the umbrella and the gate disagree about
 * what blocked, which is precisely the thing a consumer reading only the
 * SARIF would otherwise never learn. They are synthesized here rather than
 * added to the envelope's findings list, so they never count toward a
 * summary or an exit code.
 */
function diagnosticFindings(result: RunResult): Finding[] {
  return result.gates.flatMap((gate) =>
    gate.diagnostics.map((diagnostic) => ({
      schemaVersion: 1 as const,
      product: UMBRELLA_DRIVER_NAME,
      productVersion: null,
      // The diagnostic codes are already umbrella-namespaced.
      ruleId: diagnostic.code,
      severity: 'info' as const,
      severityIsDerived: true,
      blocking: false,
      message: diagnostic.message,
      subject: { kind: 'none' as const },
      fingerprint: null,
      // Which gate it is about. The run it lands in is the umbrella's, so
      // without this a reader cannot tell which gate the disagreement was
      // with.
      details: { role: gate.role, product: gate.product },
    }))
  );
}

/**
 * The gates the stage filter held back, as SARIF results.
 *
 * They follow the same rule as a gate that could not run: no tool output,
 * so no run of their own, and the statement about them belongs to the
 * umbrella. Note level and non-blocking, because a deferred gate is not a
 * failure, and it is not silence either: a consumer reading only the SARIF
 * can otherwise not tell a commit-stage log from a full one.
 */
function deferredFindings(result: RunResult): Finding[] {
  return result.deferred.map((gate) => ({
    schemaVersion: 1 as const,
    product: UMBRELLA_DRIVER_NAME,
    productVersion: null,
    ruleId: 'conductor/gate-deferred',
    severity: 'info' as const,
    severityIsDerived: true,
    blocking: false,
    message:
      `The ${gate.role} gate (${gate.product}) did not run at this stage. ` +
      `It runs from stage ${gate.stage} onwards.`,
    subject: { kind: 'none' as const },
    fingerprint: null,
    details: { role: gate.role, product: gate.product, stage: gate.stage },
  }));
}

/**
 * The gates that had nothing to check, as SARIF results.
 *
 * The rule id is the GATE'S namespace rather than the umbrella's, because the
 * statement is about that gate's coverage of this branch and a consumer
 * filtering on `intent-guard/` should see it. The run it lands in is still
 * the umbrella's, by the rule at the top of this file: a gate that produced
 * no tool output gets no run of its own, whatever the results in it say.
 *
 * Note level and non-blocking, and it is deliberately consistent with
 * gate-deferred and gate-not-enforced rather than with a
 * toolExecutionNotification. All three are the same kind of statement, so
 * they are the same kind of object; whether that whole family should be
 * notifications instead is one decision to take once, not three.
 */
function skippedFindings(result: RunResult): Finding[] {
  return result.skipped.map((gate) => ({
    schemaVersion: 1 as const,
    product: UMBRELLA_DRIVER_NAME,
    productVersion: null,
    ruleId: `${gate.product}/no-contract`,
    severity: 'info' as const,
    severityIsDerived: true,
    blocking: false,
    message:
      `The ${gate.role} gate (${gate.product}) checked nothing on this branch. ${gate.detail}`,
    subject: { kind: 'none' as const },
    fingerprint: null,
    details: { role: gate.role, product: gate.product, reason: gate.reason },
  }));
}

/**
 * The gates the policy file told not to decide anything, as SARIF results.
 *
 * These are written in TWO places on purpose, and neither one is redundant:
 *
 *  - `properties.enforced` on the gate's own run. That is the natural owner
 *    of the fact, because enforcement is a property of the gate rather than
 *    of any one finding, and it sits where a consumer already looks to find
 *    out whose results these are. It is emitted for enforced gates too, so
 *    an absent property never has to be read as either answer.
 *
 *  - a note in the umbrella's run, always. The run-level property cannot
 *    carry the case that matters most: a gate that COULD NOT RUN produces
 *    no run of its own, by the rule at the top of this file, so the only
 *    place left to say "and it was not enforced, which is why this log
 *    reports exit 0 with a gate that verified nothing" is the umbrella's
 *    own run. Emitting the note only in that case would make it look like
 *    an error report rather than a statement about coverage, so it is
 *    emitted for every unenforced gate.
 *
 * What is deliberately NOT done: touching the results themselves. A
 * critical finding stays critical, and `blocking` stays whatever the gate
 * decided. Enforcement is this repository's policy about the exit code, and
 * writing it into the field a code-scanning UI uses to describe the finding
 * would make the finding lie about what the gate found.
 */
function unenforcedFindings(result: RunResult): Finding[] {
  return result.gates
    .filter((gate) => !gate.enforce)
    .map((gate) => {
      const blocking = gate.findings.filter((finding) => finding.blocking).length;
      const what =
        gate.couldNotRun !== null
          ? `It could not run (${gate.couldNotRun.reason}), and nothing was checked by it.`
          : `It reported ${blocking} blocking finding(s) and exited ${gate.exitCode ?? -1}.`;
      return {
        schemaVersion: 1 as const,
        product: UMBRELLA_DRIVER_NAME,
        productVersion: null,
        ruleId: 'conductor/gate-not-enforced',
        severity: 'info' as const,
        severityIsDerived: true,
        blocking: false,
        message:
          `The ${gate.role} gate (${gate.product}) has enforce: false, so its verdict did not ` +
          `reach the exit code. ${what}`,
        subject: { kind: 'none' as const },
        fingerprint: null,
        details: {
          role: gate.role,
          product: gate.product,
          enforced: false,
          couldNotRun: gate.couldNotRun === null ? null : gate.couldNotRun.reason,
          blockingFindings: blocking,
        },
      };
    });
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
    // The stage sits beside the enforcement flag because the two answer the
    // same question about a published log: how much of the policy this run
    // actually represents. Without it a commit-stage log and a full one are
    // indistinguishable for any gate that appears in both.
    // contractSource and baseRef sit beside the enforcement flag and the
    // stage for the same reason those two do: they say what this run's
    // results are ABOUT. A drift finding measured against an imported spec
    // and one measured against a contract somebody approved by hand are
    // different claims, and so are one over a branch diff and one over an
    // index.
    runs.push(
      makeRun(gate.product, gate.productVersion, own, {
        enforced: gate.enforce,
        stage: gate.stage,
        ...(gate.intent === undefined
          ? {}
          : { contractSource: gate.intent.contractSource, baseRef: gate.intent.baseRef }),
      })
    );
  }

  const umbrellaFindings = [
    ...result.gates
      .flatMap((gate) => gate.findings)
      .filter((finding) => finding.product === UMBRELLA_DRIVER_NAME),
    ...diagnosticFindings(result),
    ...deferredFindings(result),
    ...skippedFindings(result),
    ...unenforcedFindings(result),
  ];

  if (umbrellaFindings.length > 0) {
    runs.push(makeRun(UMBRELLA_DRIVER_NAME, umbrellaVersion, umbrellaFindings));
  }

  return JSON.stringify({ $schema: SARIF_SCHEMA, version: '2.1.0', runs }, null, 2);
}
