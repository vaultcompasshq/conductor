# Conductor

The name is conductor. The package is not yet published. This repository is
the umbrella over the Vault & Compass guardrail gates: one policy file, one
init, one hook, and one report across three tools that each install,
version, and run on their own. The word conductor previously belonged to
the intent gate, which is now intent-guard.

## What it is

Three gates cover three boundaries of an AI-assisted coding session.
dep-guard checks what comes in: hallucinated package names, typosquats,
tampered lockfile entries. vault-guard checks what goes out: credentials
about to be committed. intent-guard checks what was approved: drift from a
frozen intent contract, and change budgets.

Run all three and you have three inits, three config files, three output
shapes, and three pre-commit hooks fighting over one file. That is the
friction this repository removes, and that is all it removes:

- **one policy file**, `.guardrails.yaml`, keyed by the role each gate
  fills rather than by the product filling it;
- **one init**, which writes that file and a single pre-commit hook running
  every enabled gate;
- **one report**, as text for a terminal or as a single SARIF 2.1.0 log
  with one run per gate.

## What it deliberately is not

It is not a fourth gate. It finds no bugs of its own, has no rules, and
scans nothing. Every finding in its report came from one of the three gates
and is labelled with which one.

It is not something you adopt before the gates are useful. Each gate keeps
its own config file, its own baseline, its own thresholds, and its own exit
codes. The umbrella never writes into any of them: it passes a policy to
each gate as command-line flags, which every one of the three already
treats as higher precedence than its own config. Delete this tool and every
gate still runs, with exactly the configuration it had, because nothing
here ever touched it.

It does not overrule a gate. A gate that says a commit is blocked blocks
the commit. The umbrella can add to that decision and never subtracts from
it.

## The policy file

`.guardrails.yaml`, at the repository root. `conductor init` writes one with
every gate listed and only the ones it found switched on.

```yaml
version: 1

gates:
  dependencies:
    product: dep-guard
    enabled: true
    options:
      fail-on: high
  secrets:
    product: vault-guard
    enabled: true
  intent:
    product: intent-guard
    enabled: true
    options:
      require-frozen: false

report:
  format: text
```

**Gates are keyed by role**, not by product. `dependencies`, `secrets`,
`intent`. The `product` field says which binary fills that role today. This
is worth one extra line: it makes a product rename a one-line edit rather
than a rename of the key your CI reads, and it leaves room for a fourth
role to arrive without the schema moving.

**`enabled`** defaults to true. A gate that is enabled and whose binary
cannot be found is a blocking finding of the umbrella's own
(`conductor/gate-missing`), never a silent skip. A gate that is switched on
and quietly absent is the failure this whole family exists to prevent.

**`options`** is handed to that gate unchanged. Each key is one of that
gate's own long flags with the leading dashes stripped: `fail-on: high`
becomes `--fail-on high`, `online: true` becomes `--online`,
`require-frozen: false` becomes `--no-require-frozen`, and a list becomes
one flag per entry. Nothing here interprets any of them, which is why a
gate can grow a flag without this package needing a release. The handful of
flags the umbrella supplies itself (the JSON format flag, `--staged`, and
the intent gate's `--project`) are rejected if you also set them, rather
than being silently overridden.

**There is no shared severity threshold, on purpose.** Two of the three
products share a four-level scale exactly; the third scores a weighted
rubric from 0 to 100 and has two budget outcomes with no severity in them
at all. One top-level `failOn` would read as one decision and mean three
different things, so setting one is an error rather than a knob that half
works. Each gate keeps its own threshold in its own `options` block,
spelled the way that gate spells it.

**`command`** takes an absolute path and overrides binary resolution for
that gate, for pointing at a build that is not installed anywhere.
Otherwise resolution tries each of that product's binary names in order,
looking on `PATH` and then in the repository's `node_modules/.bin`.

**`report.format`** is `text` or `sarif`, and `--format` overrides it.

### Precedence

1. the gate's own config file, which the umbrella never reads or writes;
2. this policy file, delivered to the gate as command-line flags;
3. a flag on the umbrella's own command line.

Layer three is narrow in v0.1: `--gate <role>` restricts a run to named
roles. There is no umbrella flag that rewrites a gate's threshold, for the
reason above.

## Commands

`conductor init` writes the policy file and one pre-commit hook.

- `--dry-run` prints every file it would write or change and writes nothing.
- `--revert` removes exactly what a previous init wrote, and nothing else.
  A file changed since init is reported and left alone.
- `--adopt` replaces one gate's own pre-commit hook with the umbrella hook.
  Without it, init reports the collision and stops rather than stacking a
  second invocation of a gate that is already hooked. A hook the umbrella
  does not recognise is never replaced, with or without `--adopt`.
- `--force`, with `--revert`, removes a file that has changed since init
  anyway, restoring an adopted hook if there was one.

A revert that cannot remove everything removes nothing that would leave the
repository half-wired, keeps the manifest describing what is left, and
exits non-zero. In particular, if the hook has been edited by hand it is
left alone and so is the policy file, because a hook running the umbrella
with no policy file to read would refuse every commit.

Two of the three gates write a marker comment into the hook they install,
so init recognises those exactly. The secret scanner writes no marker, so
its hook is recognised **by content**: a hook that mentions that tool and
runs a staged scan. That is the same test its own installer applies to its
own hook, but it is a heuristic, and a hand-written hook that happens to
call that tool the same way will be treated as its. Read what `--dry-run`
reports before running `--adopt` on a hook you did not write.

`conductor run` runs every enabled gate and prints one report.

- `--staged` gates the git index against HEAD, which is what the hook does.
- `--format text|sarif`.
- `--gate <role>`, repeatable.

### Exit codes

- **0** every enabled gate ran and none blocked.
- **1** every enabled gate ran and at least one blocked.
- **2** an enabled gate could not run: its binary is missing, it exited with
  its own could-not-run code, or it exited 1 with nothing parseable on
  stdout, which is what a rejected config file looks like from two of the
  three.

This is not the numeric maximum of the children's exit codes, because the
codes do not mean the same thing in each product. One of the three uses 2
for "could not run the checks at all"; the other two have only 0 and 1 and
use 1 both for a real finding and for a broken config. So the composed code
can differ from the maximum of its children's, and a gate that could not
run outranks a gate that blocked. A report that reads clean because nothing
looked is worse than one that says it failed.

## The hook

One hook, running `conductor run --staged`. It fails closed: a missing
umbrella binary blocks the commit with one line saying so, because a
guardrail that is off when the tool is missing is a guardrail an attacker
turns off by making the tool missing. It passes the exit code straight
through, so 2 does not collapse into 1 and report findings that were never
looked for.

A relative `core.hooksPath` is resolved against the working-tree root,
which is where git actually looks. An absolute one pointing outside the
repository is refused rather than written to, since that directory serves
every repository on the machine.

**Where git looks is not always the file to write.** husky 9 points
`core.hooksPath` at `.husky/_`, a generated and gitignored directory it
rewrites on every install; the file git executes there is a dispatcher
that adds `node_modules/.bin` to `PATH` and runs the tracked hook one
directory up. Init recognises that arrangement, by the `.husky/_`
convention or by the dispatcher's own contents, either alone being enough,
and then reads, detects, adopts, writes and reverts `.husky/pre-commit`
and never anything under `.husky/_`. Reading the dispatcher instead
reports the repository's real gate hook as foreign, so `--adopt` cannot
adopt it, and writing the dispatcher puts the hook where the next install
deletes it without saying so. Both were found by running this tool against
a real husky 9 repository rather than against a fixture.

lefthook and the pre-commit framework also install a generated script
where git looks, and neither has a tracked counterpart to write instead,
so both are recognised and refused with a pointer at the manager's own
config file (`lefthook-local.yml`, `.pre-commit-config.yaml`). A gate run
from either of those is subject to that manager's exit code rather than
the umbrella's, so 1 and 2 stop meaning different things there; that is
why init names the file rather than editing it.

## The report

The text report is one section per gate, blocking findings first, with each
gate's own threshold, its own suppressed and ignored counts, and its own
exit code and duration in the header. The counts are printed even at zero,
because they are the user's earlier decisions and hiding them makes a
repository with two hundred baselined findings read as clean.

The SARIF output is one log with one run per gate, each run's tool name and
version taken from that gate. Rule ids are product-namespaced, each result
carries the gate's own fingerprint verbatim in `partialFingerprints` under
a key naming the product, and the properties bag carries `blocking`,
`severity`, whether that severity was assigned by the umbrella rather than
by the gate, how durable that fingerprint is, and the gate's own details
bag unchanged. No location is invented: a finding with no known line gets
no region, and a finding about a missing binary gets no location at all.

## Scope of v0.1

In: the policy file and its schema, `init` with dry-run, revert, and adopt,
`run` producing the combined text report and a combined SARIF log, and the
composed exit code.

Out, deliberately: a unified baseline (each gate keeps its own, and their
fingerprints are not equally durable, so one shared file would expire
entries silently for one product and not another), an MCP registration, a
GitHub Action, running the gates concurrently, and any finding of the
umbrella's own beyond `conductor/gate-missing`.

Also out: a published package. The gates are the product; this is the
convenience layer over them, and it stays unpublished until it has earned a
config file worth keeping.

## License

MIT, [Vault & Compass](https://vaultcompass.io)
