# Intent spec auto-selection on whole tokens, a weak-match statement, and no guess on a tie

Date: 2026-10-17
Status: design, written before the code. Reviewed once (FIX ROUND: three
blockers, eight non-blocking items, several of them rulings); this revision
applies all of them, listed in section 13. Line numbers are the tree at
afd0ea8 (0.10.0 released).
Scope: conductor only. Plan item 4.3, ruled design-first because it is the
contract-selection path: choosing the wrong spec silently judges a change
against the wrong rules, and choosing none when one exists silently skips the
intent gate.
Closes: the 2026-10-11 dogfood finding. On a sibling repository a branch whose
slug was the two letters `pr` was bound by the branch-name convention to an
unrelated spec whose stem contained those two letters inside a longer word,
and the run reported a green drift check against that spec's contract.

## 1. Constraints (not reopened here)

- AGENTS.md: the umbrella scans nothing, never writes a gate's config, and
  raises findings only about the gates. Choosing which spec to import is
  already the umbrella's job (src/intent-spec.ts, src/intent-prepare.ts);
  this design changes how it chooses and what it says about the choice. No
  finding code is added. The statements below are notifications and report
  lines, never findings, by the discriminator at src/output-sarif.ts:647-685
  (a statement about how much of the policy a run covered is a
  notification).
- The order of the three sources stays exactly as it is: `--spec` (or the
  Action's `spec` input), then the first `Spec:` line of the pull request
  body (or its `Spec: none` waiver), then the branch-name convention, with a
  frozen native contract on the base outranking all three on a trust-base
  run (INVARIANTS "Spec discovery: three sources, and the order is the whole
  decision" and "The repository's own frozen contract wins"). Only the third
  source changes.
- A branch with no spec stays advisory and never reaches the exit code
  (INVARIANTS "A branch with no spec is advisory, and never changes the exit
  code"). Section 6 says why this design keeps that and what it adds.

## 2. What the code does today

Read on afd0ea8:

- Candidacy. `stemMatches(stem, slug)` (src/intent-spec.ts:105-110) is
  `stem.includes(slug) || slug.includes(stem)`, a character substring test in
  either direction, case-sensitive, with no minimum length. Its only caller
  is `bestMatch` (src/intent-spec.ts:193).
- The slug. `branchSlug` (src/intent-spec.ts:86-89) drops the first `/`
  segment and keeps the rest verbatim, so `feat/online/widget-cache` gives
  `online/widget-cache` and a branch with no slash is its own slug.
- The stem. `normalizeStem` (src/intent-spec.ts:99-102) strips a `.md`
  extension, a `YYYY-MM-DD-` prefix and a trailing `-design`.
- Ranking. `bestMatch` (src/intent-spec.ts:191-210) filters by
  `stemMatches`, then sorts: a stem equal to the slug first, then the LONGER
  stem, then the lexically greatest filename (the newest date). It always
  returns the head of the list when there is any candidate: there is no
  notion of a tie, and nothing records why the winner won.
- Callers of `bestMatch`, two, and they are the two selection paths:
  - working tree: `discoverSpec` (src/intent-spec.ts:339-351), listing
    `docs/superpowers/specs` with `readdirSync`;
  - trust base: `discoverSpecAtRef` (src/intent-prepare.ts:1139-1156),
    listing the same directory AT THE TRUST BASE with
    `markdownFilesAtRef`, and reading the chosen file from the base.
  A third, indirect use: when the base has no spec, `prepareAgainstTrustBase`
  calls `discoverSpec` on the head (src/intent-prepare.ts:1283-1302) only to
  write a proposal line; that result never becomes the contract.
- Where the branch comes from. `currentBranch` (src/intent-base.ts:184-195):
  `GITHUB_HEAD_REF` when set (the pull request's head branch name, chosen by
  whoever opened the pull request, fork contributors included), else
  `git rev-parse --abbrev-ref HEAD`, else null. So on a pull request the
  SLUG IS HEAD-CONTROLLED and, under `--trust-base`, the CANDIDATE LIST AND
  EVERY BYTE IMPORTED ARE BASE-CONTROLLED.
- When it runs at all. Only on a pull-request shaped run
  (`isPullRequestShaped`, src/run.ts:290-295: `--spec`, `--trust-base`, or a
  resolvable base ref). The pre-commit hook (`--staged --stage commit`, no
  base) never reaches spec selection.
- Zero candidates. `discoverSpec` returns `{ kind: 'none' }`; prepareIntent
  returns a `skip` with reason `no-contract` and the detail "No frozen ...
  and no spec under docs/superpowers/specs matching branch "<b>""
  (src/intent-prepare.ts:599-614; the trust-base wording at :1309-1320).
  run.ts records a `SkippedGate` (src/run.ts:94-99, pushed at :607-614),
  which never reaches the exit code.
- One or several candidates. The winner is imported, frozen and run; the
  report names only the path: `contract: spec <path> [plus plan <path>]
  base: <ref>` (`contractLine`, src/output-text.ts:276-295), and the SARIF
  run properties carry `contractSource` (src/output-sarif.ts:1052-1058).
  Nothing in either says the spec was chosen by branch name, on what
  evidence, or that another candidate came close.
- There is NO policy key for the spec and NO policy key that requires a
  contract: src/policy.ts and schema/guardrails.schema.json contain neither
  (searched for `spec`, `require-contract`, `requireContract`). The explicit
  selectors are `--spec` on the CLI, the Action's `spec` input
  (action.yml:43-49, passed as `--spec` at :1110 and :1358) and a `Spec:
  <path>` line in the pull request body.

So the failure has two halves. Candidacy is a substring test, so two letters
inside an unrelated word make a candidate. And a single candidate, or a
winner chosen by stem length among several, is reported exactly like a spec
whose name is the branch, so a reader cannot tell a guess from a binding.

### 2.1 A worked example from this repository

This document's own stem is `intent-spec-auto-selection`, and the branch it
is written on is `design/spec-selection`, slug `spec-selection`. The old rule
does not match them (neither string contains the other). The rule below does
not match them either (section 3.3: the slug's tokens are not one contiguous
run of the stem's). Neither rule binds this branch to this spec, and the
right remedy in both worlds is the same: a `Spec:` line, or a branch named
after the stem. The example is here so nobody reads section 3 as "more
matches": it is fewer, and different only where the old answer was a guess.

## 3. The token rule

### 3.1 Tokens

`tokens(text)`:

1. Fold ASCII letters only: `A` to `Z` become `a` to `z`
   (`replace(/[A-Z]/g, ...)`), and every other character is left exactly as
   it is. Not `toLowerCase()`: that maps U+212A KELVIN SIGN to an ASCII `k`
   (and U+0130 to `i` plus a combining dot), so a branch spelled with a
   Kelvin sign would fold into an ASCII word and could bind a spec, which
   is the non-Latin route the charset rule in 3.2 (and open point 7) exists
   to close. With ASCII-only folding a non-ASCII character survives folding
   unchanged and then fails the 3.2 charset, so no non-Latin character can
   ever contribute to a match.
2. Split on every run of the delimiters hyphen, underscore, slash and
   ASCII whitespace (`/[-_/ \t\n\r\f\v]+/`). The slash is a delimiter
   because the slug keeps every segment after the first
   (`online/widget-cache`), and whitespace because a filename may carry it.
   ASCII whitespace only, never `\s`: in JavaScript `\s` also matches
   Unicode whitespace (U+00A0, U+2000 to U+200A, U+2028, U+2029, U+3000,
   U+FEFF), which git allows in a ref name, so `feat/widget` plus U+00A0
   plus `cache` would split into `widget cache` and bind `widget-cache.md`
   exactly, a binding made by a non-ASCII character. With the ASCII class
   that U+00A0 stays inside one token, which then fails the 3.2 charset.
3. Drop empty strings (a leading, trailing or doubled delimiter).

A dot is NOT a delimiter: `1.2.1-base-and-superpowers` has the token `1.2.1`,
and splitting it would produce three one-character tokens that mean nothing.

The slug side is `tokens(branchSlug(branch))`; `branchSlug` is unchanged
(open point 6). The stem side is `tokens(normalizeStem(fileName))`;
`normalizeStem` is unchanged.

### 3.2 Significant tokens

A token is SIGNIFICANT when all of these hold:

- it is at least 3 characters long (`MIN_TOKEN_LENGTH = 3`);
- it consists only of `a-z`, `0-9` and `.` after folding;
- it contains at least one letter;
- it is not in `STOP_WORDS`.

Why each:

- Length 3. Two-letter tokens (`pr`, `ci`, `ui`, `db`, `v2`) are the shape
  of the dogfood failure, and they recur across unrelated work. Three keeps
  the short domain words a team actually names features after (`api`,
  `cli`, `osv`). Raising it to 4 would drop those, which open point 1
  weighs.
- Charset. A git ref name may carry backticks, angle brackets, `@`, `+` and
  more. A token outside `[a-z0-9.]` is never significant, so the only tokens
  the report ever prints as "shared" (section 5) are made of letters, digits
  and dots, whatever the head branch was called. A branch named in a script
  other than Latin therefore never auto-selects; it pins (open point 7).
- A letter. Numbers are the other recurring collision: years, version
  numbers (`0.10.0`), issue numbers. A branch `fix/116-cache` and a spec
  `...-116-...` sharing an issue number is a real binding, but `2026` and
  `10` are not, and a rule that cannot tell them apart takes neither. The
  token still participates in contiguity (3.3); it just cannot be the
  evidence on its own.
- Stop words. Words that appear in branch names and spec names because of
  the naming convention, not because of the feature. The list is closed,
  exported from src/intent-spec.ts, and pinned exactly by a test (U3):

      Change-type words:   feat feature fix bugfix hotfix chore docs
                           refactor test tests wip release build perf
                           style revert deps bump
      Convention words:    design spec specs plan draft review followup
                           temp tmp
      Function words:      and the for with from into onto per via not
                           add use new more misc

  Two-letter words (`pr`, `ci`, `ux`, `up`) need no entry: the length rule
  already excludes them. The test comment lists them so nobody adds them
  "for safety" and believes the list is the reason.

A stop word is ignored as EVIDENCE, never deleted from the sequence: it still
occupies its position for the contiguity test below. Deleting it would make
`per-gate-timeout-stated-reason` contiguous inside
`per-gate-timeout-and-stated-reason`, a binding the old rule never made, and
section 7's one-direction migration property would be lost.

### 3.3 Candidacy: a whole-token run, in either direction

A spec is a CANDIDATE for a branch when:

1. the shorter of the two token sequences appears as ONE CONTIGUOUS RUN of
   the longer one, compared token by token for equality (either direction,
   as the old rule was), and
2. that run contains at least one significant token.

Equal sequences are the case where the run is all of both.

This is the old substring test moved from characters to whole tokens, and
nothing looser. Two looser rules were considered and rejected:

- ANY ONE SHARED TOKEN (the plan's minimum). `fix/timeout-knob` would become
  a candidate for every spec with `timeout` anywhere in its stem, and a
  repository's own domain word (`gate` in this one) would make most branches
  candidates for most specs. It turns a selection that today finds nothing
  into one that finds something weak, which is the direction the dogfood
  failure ran.
- TOKEN-SET CONTAINMENT, order ignored. `cache-widget` would bind to
  `widget-cache`, and `spec-selection` to `intent-spec-auto-selection`
  (section 2.1). Both are bindings the old rule never made.

What the run rule buys is a provable property, stated against one exact
normalisation, `norm(x) = tokens(x).join("-")`: whenever the new rule makes
a pair a candidate, `norm(stem).includes(norm(slug))` or
`norm(slug).includes(norm(stem))` holds. Proof: a contiguous run of tokens,
joined by single hyphens, is a substring of the longer sequence joined the
same way. So on normalised strings the change only removes candidates.

On the RAW strings the old rule actually saw, it also gains exactly the pairs
where raw and normalised differ, and only those. The complete list:

- ASCII case: `Widget-Cache` against `widget-cache`;
- underscore for hyphen: `widget_cache` against `widget-cache`;
- slash for hyphen: slug `online/widget-cache` against stem
  `online-widget-cache` (`includes` is false both ways on the raw strings);
- whitespace for hyphen: a filename `widget cache.md` against
  `widget-cache`;
- doubled, leading or trailing delimiters: `widget--cache` against
  `widget-cache`, or slug `widget-` against stem `big-widget` (raw
  `includes` is false both ways; normalised, `widget` is in `big-widget`).

No other kind of pair is gained. In particular no non-ASCII character
folds into ASCII (3.1 step 1) or acts as a delimiter (3.1 step 2), so a
U+00A0 between `widget` and `cache` binds nothing, and a Kelvin-sign
`Key-rotation` does not
bind `key-rotation`.

### 3.4 Exact

A candidate is EXACT when the two folded token sequences are equal (and, by
3.3, contain a significant token). `Widget_Cache` and `widget-cache` are
exact. A slug made only of non-significant tokens is never exact, even
against a stem spelled the same: `pr` against a spec named `...-pr.md` selects
nothing (open point 2).

### 3.5 What a slug of only short or stop tokens does

No auto-selection, ever, whatever the specs directory holds. The outcome is
`none` with the cause `no-usable-token` (section 4.3), and the report says the
branch name has no word of three or more letters that could choose a spec,
and how to name one explicitly. The dogfood slug `pr` lands here.

## 4. Ranking, ties and the weak statement

### 4.1 Groups

Candidates are grouped by their folded stem sequence. Files in one group are
versions of one spec (the same stem with different dates, or a `-design` and
a plain file); the group's member is the lexically greatest filename,
exactly as today's last sort key. That is the newest date only when every
name carries a well-formed date; it is a lexical order, not a date parse.
The order is deterministic in every case, including the one that looks like
a tie: `2026-09-03-x.md` beats `2026-09-03-x-design.md`, because at the first
differing character `.` (0x2e) sorts after `-` (0x2d). A group is never
ambiguous with itself: that is what keeps today's "takes the lexically newest
filename when several specs match" (tests/intent-spec.test.ts:161) passing.

A malformed date is not stripped (`normalizeStem` only removes an exact
`YYYY-MM-DD-` prefix), so `2026-9-03-widget-cache.md` has the stem
`2026-9-03-widget-cache`, a different group from `widget-cache`. On an exact
slug that costs nothing (the well-formed file is exact and wins). On a
non-exact slug such as `cache` the two groups score the same, and the run
reports a spurious `spec-ambiguous` naming both. That outcome is advisory,
never a wrong binding, and the remedy is to fix the filename; the README says
to date every spec in `YYYY-MM-DD-` form.

### 4.2 Score and order

Each group's score, compared in this order, higher first:

1. exact (1) or not (0);
2. the number of significant tokens in the shared run;
3. the length of the longest significant token in the shared run.

The old second key, the longer stem, is gone. It was the key that let a long
vague stem beat a short precise one whenever both contained the slug, and
section 3.3 already guarantees every candidate shares a whole run.

The existing ranking tests keep passing under this order:
tests/intent-spec.test.ts:175 and :193 are exact wins; :206 (slug
`widget-cache-rev-two`, stems `cache` and `widget-cache-rev`) is a 3 against
1 count win. Section 8.1 R1 re-runs them unchanged.

### 4.3 Outcomes

`selectByBranch(names, branch)` is the one function both selection paths
call (it replaces `bestMatch` at src/intent-spec.ts:340 and
src/intent-prepare.ts:1144, and `stemMatches`, which is deleted). It returns:

    type BranchSelection =
      | { kind: 'selected'; name: string;
          strength: 'exact' | 'strong' | 'weak';
          weakBecause: Array<'single-token' | 'length-tiebreak'>;
          shared: string[];            // significant tokens of the run
          runnerUp: string | null;     // next group's member, if any
          legacy: string | null }      // what bestMatch would have chosen
      | { kind: 'none';
          why: 'no-usable-token' | 'no-candidate' | 'ambiguous';
          tied: string[];              // ambiguous only, sorted, capped (4.4)
          legacy: string | null };

- No significant token in the slug: `none`, `no-usable-token`.
- Significant tokens, no candidate: `none`, `no-candidate`.
- The top two groups have EQUAL scores on all three keys: `none`,
  `ambiguous`, every group tied at the top listed in `tied`. No guess.
- Otherwise the top group's member is `selected`, with a strength:
  - `exact` when key 1 is 1;
  - `weak` when not exact and either the run has exactly ONE significant
    token (`single-token`), or the runner-up group ties it on keys 1 and 2
    and loses only on key 3 (`length-tiebreak`). Both reasons can hold;
  - `strong` otherwise: not exact, at least two significant shared tokens,
    and a win on count.

Why a tie is none and not a guess. Every key the old code used after the
first was a guess about which feature the branch meant: the longer stem, then
the newest date. A tie on everything this design measures is the code saying
it does not know, and the honest output of not knowing is to say so, name the
contenders, and say how to choose. The alternative orders that would break
the tie (fewest unshared tokens, newest date) each pick the right spec in
some repositories and the wrong one in others, silently either way.

Why the length key may still decide, but only weakly. The plan asks for the
longer shared token as a ranking key, and it is a real if thin signal (`cache`
against `rev`). It is allowed to pick a winner, and the run then says the
pick was weak and names the runner-up, so a reader learns a choice was made
on thin evidence on the same line that tells them which spec was used.

Why one shared token is weak. Length does not measure distinctiveness (`gate`
is long and means nothing in this repository; `osv` is short and means
exactly one thing), and no stop list can know a repository's own domain
words. One significant token is the shape every bad binding found so far had,
so every single-token selection carries the statement, whatever the token.

### 4.4 Ambiguity, capped

`tied` lists every tied group's member, sorted lexically, capped at 5 with
"and N more". The cap is for the report line; SARIF details carry the full
count.

### 4.5 The legacy answer, reporting only

`legacy` is what `bestMatch` would have returned on the same inputs: the old
`stemMatches` plus the old sort, kept as a private function
`legacySelection` in src/intent-spec.ts for one minor release and used for
nothing but the sentence in section 5. When `legacy` names a file and the new
outcome is `none`, or `selected` with a different file, the report says so
once. Section 6 is why that sentence exists; open point 4 is when it goes.
It never selects: test A7 kills the mutation that falls back to it.

## 5. Every output surface

### 5.1 Data model

- `SpecDiscovery` (src/intent-spec.ts:42-56): the `convention` variant gains
  `match: ConventionMatch` (`strength`, `weakBecause`, `shared`, `runnerUp`,
  `legacy`); the `none` variant gains an optional `selection: { why, tied,
  legacy }`, present when a branch was available. `discoverSpecAtRef`'s
  `SpecAtRef` gains the same two fields.
- `ContractSource` `imported` (src/intent-prepare.ts:127) gains an optional
  `match?: ConventionMatch`, set only when the spec came from the
  convention. Its presence is how every renderer knows the branch name chose
  the spec; nothing recomputes it from the policy or the path.
- `IntentPrepareResult` `skip` and `SkippedGate` (src/run.ts:94-99) widen
  `reason` to `'no-contract' | 'contract-waived' | 'spec-ambiguous'` and gain
  an optional `selection` (`why`, `tied`, `legacy`) for the details bag.
  `no-usable-token` and `no-candidate` stay reason `no-contract`: they are
  the ordinary adoption-ramp state and consumers already filter that id.
  `ambiguous` gets its own reason because its remedy differs (a spec exists;
  choose one) and because a tie that today silently picks a spec must not
  file itself under "nobody wrote one".

### 5.1a The trust-base path returns the same outcomes

`prepareAgainstTrustBase` (src/intent-prepare.ts:1212-1321) today ends in an
unconditional `no-contract` return (:1309-1320) whose detail says the base
carries "no spec under docs/superpowers/specs for branch <b>". For an
ambiguous base that sentence is false: the base carries several. So:

- `discoverSpecAtRef`'s `none` result carries the same `selection` (`why`,
  `tied`, `legacy`) as `discoverSpec`'s, computed by `selectByBranch` over
  the names listed at the trust base.
- After the existing `found` branch (:1267-1279) and BEFORE the head-spec
  block (:1281-1308), a `none` with `why` `ambiguous` returns
  `{ kind: 'skip', reason: 'spec-ambiguous', detail, proposals }`, keeping
  the `headContractProposals` lines already collected at :1243. The detail
  is the 5.2 ambiguous sentence with "on "<trustBase>"" after the count and
  the tied files named as the base lists them, plus the legacy clause when
  `legacy` is set. The head-spec proposal line is not computed on this path
  (no spec is proposed when the base already has candidates; section 7).
- `no-usable-token` and `no-candidate` keep the existing return at
  :1309-1320, with the `no-usable-token` sentence and the legacy clause
  appended to its detail exactly as on the working tree, and its proposals
  unchanged.

Tests A3 and A7 run through both paths (section 9.2).

### 5.2 Wording

Weak, selected (gate block, under the contract line, every report):

    match: weak, the branch name shares only "cache" with this spec's name.
    To be sure this is the right contract, add a "Spec: <path>" line to the
    pull request body or rename the branch to the spec's name.

With `length-tiebreak`, the first sentence becomes "... shares "widget" with
this spec and "rev" with docs/superpowers/specs/<runner-up>; the longer word
decided it." Locally (no `GITHUB_EVENT_PATH`) the remedy names `--spec`
instead of the pull request body.

Ambiguous (skip detail, which is also the SARIF message):

    No spec was chosen: the branch name "<b>" matches 2 specs equally
    (docs/superpowers/specs/<a>, docs/superpowers/specs/<b>), and conductor
    does not guess between them. Add a "Spec: <path>" line to the pull
    request body, or rename the branch to one spec's name.

`no-usable-token` (appended to the existing no-contract detail):

    The branch name "<b>" has no word of three or more letters that is not a
    common branch word (fix, feat, wip, ...), so it cannot choose a spec.

`no-candidate`: the existing detail, unchanged.

Legacy clause, when it applies (appended once, to the skip detail or as a
`note:` line under the contract line):

    Before conductor 0.11.0 this branch name chose <legacy> by a partial-word
    match; it no longer does.

and, for a changed winner (a `note:` line under the contract line, any
strength):

    Before conductor 0.11.0 this branch name chose <legacy>; it now chooses
    this spec, which matches it on whole words.

The branch name in these sentences is printed exactly as the existing
no-contract detail already prints it (src/intent-prepare.ts:611); the
`shared` words are the charset-restricted tokens of 3.2, so they carry no
markup and no workflow-command text whatever the branch was called.

### 5.3 The surface table

| surface | what changes | where |
|---|---|---|
| text report, gate block | the weak `match:` line under the contract line; the legacy `note:` line when the winner changed | `contractLine` and the note at src/output-text.ts:276-295, :317-318 |
| text report, one-line clean summary | a weak match, or a changed legacy winner, keeps the run off the one-line summary, the way `intent.note` already does. `isFullyClean` also consults `result.skipped`: a `spec-ambiguous` skip, or any skip carrying `legacy`, keeps the run off the one-line summary too, so a local run does not lose the sentence (the Action already passes `--verbose`, action.yml:1057) | `isFullyClean`, src/output-text.ts:1241-1257 |
| text report, skipped line, verdict, summary clause | `skipWording` gains `spec-ambiguous`: line "spec ambiguous", verdict "matched two or more specs equally, so none was chosen", summary "No spec chosen, two or more matched the branch equally" | src/output-text.ts:466-478 |
| --verbose | the gate block of a convention selection gains `chosen by: branch name, <strength>, shared: <words>[, runner-up <file>]`, printed for every strength, so a strong or exact selection is visible too | `gateSection`, src/output-text.ts:297 onward |
| text report header | a fixed line, after the present-on-base line when that is present: one of exactly four strings (5.4) | `renderText`, src/output-text.ts:1515-1522 |
| SARIF | weak: a NOTE notification `intent-guard/spec-weak-match`, details `{ role, product, spec, shared, weakBecause, runnerUp }`; ambiguous: the existing skipped notification under id `intent-guard/spec-ambiguous`, details gain `tied` (full list) and `tiedCount`; every skip and selection with a `legacy` answer carries `legacySelection` in details; `contractSource.match` rides in the run properties unchanged in shape | src/output-sarif.ts:686-699 and :1052-1058, plus one new notification builder beside `legacyStateDirNotifications` (:579) |
| verdict token, exit code | unchanged. A weak selection whose gate blocks still blocks; an ambiguous skip is a skip | src/exit-codes.ts, no change |
| Action step summary | copies the fixed header line when it is one of the four strings (5.4) | action.yml:1210-1222 |
| pull-request comment | the posted text report, so it carries everything above | no change |
| pre-commit hook | unreachable: the hook run is not pull-request shaped | no change |

### 5.4 The step-summary line

The Action's summary must not echo repository text (action.yml:1161-1164
and :1210-1216 say why for line 3). So the header line is a CLOSED SET of
four strings, naming no branch, no file and no token, listed in precedence
order:

    intent-spec: none chosen, two or more specs matched the branch equally
    intent-spec: none chosen, this branch chose a spec before conductor 0.11.0
    intent-spec: a different spec chosen than before conductor 0.11.0, see the report
    intent-spec: weak match, see the intent gate in the report

When each prints:

1. ambiguous: the outcome is `none` with `why` `ambiguous`.
2. none, changed: the outcome is `none` (any cause, including
   `no-usable-token` and `no-candidate`) and `legacy` is set. The dogfood
   `pr` case is this one.
3. winner changed: the outcome is `selected` with any strength and `legacy`
   names a different file. This is the shape closest to the original
   finding, a branch that was being judged against one spec and is now
   judged against another, so it outranks the weak line.
4. weak: the outcome is `selected`, `weak`, and string 3 did not apply.

At most one is printed, the first that applies (1 and 2 can both hold when
the old rule broke a tie by stem length; 3 and 4 when the new winner is
weak). A `none` with no `legacy` and a cause other than `ambiguous` prints no
line: that is the ordinary adoption ramp, and an intent-only run already gets
the nothing-checked sentence.

The Action reads lines 3 AND 4 of the report (today it reads line 3), and
copies each line that matches, whole, either the existing present-on-base
shape or one of the four strings above. Anything else on either line is
ignored, exactly as line 3 is today. The present-on-base line, when present,
stays line 3, so the existing contract is unchanged for every report that
has no intent-spec line.

## 6. Fail-closed direction

### 6.1 Today

There is no policy key that requires a contract (section 2). A pull-request
run where the convention finds nothing is a `no-contract` skip: one report
line, an `intent-guard/no-contract` notification, the summary clause, and the
`nothing-checked` token when it was the only gate. It never reaches the exit
code, enforced or not, by a written invariant. A run where the convention
finds the WRONG spec imports it, runs it, and reports its verdict, green or
red, as the verdict of the intent gate. That second path is the defect: it is
the only one of the two that can produce a pass that is about something else.

### 6.2 After

- Every outcome that used to be "wrong spec, green" becomes one of: the right
  spec by a whole-token run (selected, strong or exact); a single-token or
  length-decided spec, selected and labelled weak on four surfaces; or no
  spec, reported as a skip with its cause. None of the three is silent.
- No outcome is newly a pass where it was a block for a reason the design
  did not intend: a weak selection keeps its verdict and its enforcement
  (test A8 kills a mutation that treats weak as advisory). The only pairs
  that move from "judged" to "skipped" are the ones section 7 lists, and each
  says so (the legacy clause and the step-summary line), so a reviewer who
  saw the intent gate judge this branch yesterday sees today why it did not.
- `no-contract` and `spec-ambiguous` stay advisory, by the existing
  invariant, not as a new concession. Turning "no spec chosen" into
  could-not-run would fail every pull request whose branch shares a word with
  two specs, on the adoption ramp, which is how a gate gets switched off
  repository-wide (the reason that invariant was written). Open point 3
  records the alternative.

### 6.3 What does not change

- `--spec`, the Action `spec` input and a `Spec:` line are never subject to
  the token rule: a named spec is taken as named (and, on a trust-base run,
  read from the base), as today.
- A missing `--spec` is still reported, never replaced; an unusable `Spec:`
  path still falls through to the convention, now the stricter one.
- A frozen native contract on the base still outranks everything.

## 7. Trust boundary

Where each input comes from on a pull-request run with `--trust-base`:

- the slug: the head branch name (`GITHUB_HEAD_REF`), chosen by whoever
  opened the pull request, fork contributors included;
- the candidate list: `docs/superpowers/specs` listed at the trust base
  (`markdownFilesAtRef`, src/intent-prepare.ts:1140);
- the selected spec's bytes and its plan's: read from the trust base
  (src/intent-prepare.ts:1147 and `planAtRef` at :1050-1074);
- the `Spec:` line: the pull request body, chosen by the same author.

So a head branch name can only ever choose AMONG THE BASE'S SPECS, and the
spec it chooses is the base's text. It cannot add a candidate: a spec the
head adds is never in the candidate list. It is reported as a proposal ONLY
when the base selects nothing at all, today's behaviour and unchanged here:
the head-spec proposal line (src/intent-prepare.ts:1281-1308, which uses
`selectByBranch` only to word that line) is reached after the `found` return
at :1267-1279 and, after 5.1a, after the `spec-ambiguous` return too. When
the base selects a spec, a spec the head adds gets no line; this design adds
no new proposal for it. Nor can the head edit the chosen spec (an edit to it
is a proposal, `importedFileProposals` at :1173-1192).

Can it pick a WEAKER contract from the base's set? Yes, and it could before
this change, by two routes this design leaves exactly as they are: name the
branch after the weaker spec, or write `Spec: <weaker spec>` in the body,
which outranks the convention. It can also choose NO contract, by a branch
name that matches nothing or by `Spec: none`. The convention is therefore not
a control against the pull request's author and never was; it is a
convenience that saves the author a line in the body. This design does not
pretend otherwise and does not need to:

- What bounds the author is the frozen native contract on the base, which
  outranks the convention, the `Spec:` line, the waiver and `--spec` on every
  trust-base run (INVARIANTS "The repository's own frozen contract wins").
  The README already tells a repository that wants a non-waivable gate to
  freeze one (README.md:1218-1224), and the CHANGELOG entry repeats it.
- What makes the author's choice visible is the report: the contract line
  names the spec used (today), and after this change a weak or length-decided
  choice says so, and an ambiguous one names every contender. A reviewer who
  expected spec A and sees "match: weak ... spec B" has the facts on the
  comment itself.
- What the change removes is the ACCIDENTAL wrong binding, which is the one
  the author did not choose and the reviewer had no reason to look for.

Two narrower properties, each pinned:

- On the normalised strings `tokens(x).join("-")` every new candidate was an
  old candidate (section 3.3, test U5). On raw strings a head branch name can
  gain a binding it lacked on 0.10.0 only through the five foldings listed in
  3.3: ASCII case, underscore, slash, whitespace, and doubled, leading or
  trailing delimiters. Each of those gains reaches only a spec whose name
  spells the same words in the same order, and no non-ASCII character can
  produce one.
- Head-controlled text reaches the step summary never (5.4, a closed set) and
  the report only as the branch name already printed today plus shared words
  restricted to `[a-z0-9.]` (3.2, test O2).

Runs without a trust base (a local run with `--base`, or a CI run with
`GITHUB_BASE_REF` and no trust base) list and read the working tree, as
today; the same `selectByBranch` decides, so the two paths cannot drift.

## 8. Migration

Which existing bindings change, by shape. The implementer measures the real
extent before release (8.1) and the CHANGELOG states the shapes, not a count.

LOST (judged on 0.10.0, skipped or re-chosen now):

1. A slug that matched only inside a word: `pr` in `prepare-...`, `cache` in
   `caches-...`, `widget` in `widgets`. Now `no-usable-token` or
   `no-candidate`.
2. A slug of only short or stop tokens: `fix/pr`, `wip`, `chore/deps`. Now
   `no-usable-token`, whatever the specs directory holds.
3. A slug contained in two or more different stems (`widget-cache` against
   `widget-cache-index` and `widget-cache-rev`). 0.10.0 chose the longer stem;
   now `spec-ambiguous`, naming both.
4. A winner that changes: several candidates where the old longer-stem key
   and the new count key disagree. Rare; the legacy clause names the old one.

NEWLY WEAK (same spec, now labelled): every single-token selection, for
example `fix/cache` choosing `widget-cache`. The verdict is unchanged; the
run now prints the weak line and so leaves the one-line summary.

GAINED, only by folding, and only these five kinds (3.3): ASCII case
(`Widget-Cache` against `widget-cache`); underscore (`widget_cache`); slash
(slug `online/widget-cache` against stem `online-widget-cache`); whitespace
(a filename `widget cache.md`); and doubled, leading or trailing delimiters
(`widget--cache`). 0.10.0 matched none of them because `includes` compares
raw characters. A non-ASCII spelling (a Kelvin sign for `K`) gains nothing.

Remedy, for every lost or weak binding: add a `Spec: <path>` line to the pull
request body, or name the branch after the spec's stem (the filename without
its date and `-design`). For a repository that wants one contract regardless
of branch names, freeze a native contract on the base branch.

### 8.1 Measuring it

Before the release, the implementer runs `legacySelection` and
`selectByBranch` side by side over real inputs from the four public guard
repositories: each repository's `docs/superpowers/specs` listing and the head
branch names of its merged pull requests (`gh pr list -R <repo> --state
merged --limit 1000 --json headRefName`; the explicit `--limit` matters,
since the default is 30). The number of branch names returned per repository
is recorded beside the table, and if any repository returns exactly the
limit the run is repeated with a larger one, so the baseline never silently
covers a prefix of the history. The table of pairs whose outcome differs is
committed under tests/fixtures as a baseline a later run can diff against,
per the org rule that a detection change is checked against real artifacts
and not only against fixtures its author wrote. The fixture is a tracked file
and must pass `pnpm lint` (scripts/check-public-hygiene.mjs): any branch name
or spec name that trips the hashed blocklist, a machine path or a non-ASCII
dash is dropped from the fixture before commit, and the number dropped is
recorded, never the dropped names. The CHANGELOG then says "affects
branch names shaped like ..." from that table. Not measured for this design:
the design machine ran no interpreter against those inputs, and no count is
claimed here.

## 9. Test plan

Unit tests in tests/intent-spec.test.ts unless named; run tests in
tests/intent-prepare.test.ts and tests/intent-run.test.ts; the Action
summary in tests/action.test.ts beside "copies a present-on-base line 3 to
the step summary, and nothing else from line 3". Each test names the
mutations it must kill; the implementer runs each listed mutation and shows
it red.

### 9.1 The token rule and the ranking

U1. `tokens`: `Feat/Online/Widget_Cache` gives `feat online widget cache`;
    `a--b//c` gives `a b c`; `1.2.1-base` keeps `1.2.1`; a leading or
    trailing delimiter yields no empty token. Kills: no case fold; not
    splitting on underscore or slash; splitting on dot.
U2. Significance: `pr`, `ci`, `v2` (short); `fix`, `wip`, `and`, `design`
    (stop words); `2026`, `0.10.0` (no letter); a token with a backtick or
    `@` (charset) are each not significant; `api`, `cache`, `1.2.1a`, `rev2`
    are. Kills: `MIN_TOKEN_LENGTH` 2; dropping the letter requirement;
    dropping the charset rule.
U3. `STOP_WORDS` equals the exact list of 3.2. Kills: an entry added or
    removed without editing the test (and so without review).
U4. Candidacy: `widget-cache` in `widget-cache-index` (yes, slug in stem);
    `widget-cache-rev-two` against `cache` (yes, stem in slug);
    `widget-caches` against `widget-cache` (NO; the substring rule says yes);
    `cache-widget` against `widget-cache` (NO); `spec-selection` against
    `intent-spec-auto-selection` (NO; set containment says yes);
    `per-gate-timeout-stated-reason` against
    `per-gate-timeout-and-stated-reason` (NO; dropping stop words before the
    contiguity test says yes). Kills: restoring `includes`; any-shared-token;
    set containment; deleting stop words from the sequence.
U5. One-direction property: over a generated corpus (every pair from a list
    of about forty slugs and forty stems built to exercise prefixes,
    suffixes, interior words, short and stop tokens, digits, ASCII case,
    underscores, slashes (`online/widget-cache`), whitespace
    (`widget cache`), doubled, leading and trailing delimiters
    (`widget--cache`, `-widget-cache-`, slug `widget-` against stem
    `big-widget`), a U+00A0 no-break space in place of a hyphen, and a
    U+212A Kelvin sign in place of `K`), whenever the new rule makes a candidate, the old `stemMatches`
    holds on `tokens(x).join("-")` of both sides, that exact normalisation
    and no other. A second assertion over the same corpus: every pair that
    is a new candidate but NOT an old candidate on the raw strings differs
    from its normalised form only by one of the five foldings of 3.3. A
    third: the Kelvin-sign `Key-rotation` is not a candidate for
    `key-rotation`. A fourth: branch `feat/widget` plus U+00A0 plus `cache`
    is not a candidate for `widget-cache` (and is not exact). Kills: any
    rule looser than 3.3; restoring `\s` in the delimiter class (the U+00A0
    assertion goes red); `toLowerCase()` in place
    of ASCII-only folding (the Kelvin assertion goes red).
R1. The existing ranking tests at tests/intent-spec.test.ts:161, :175, :193
    and :206 pass unchanged. New: exact beats a higher count; count beats
    length; two files with one stem and different dates are one group and the
    lexically greatest filename wins (not ambiguous); `2026-09-03-x.md` beats
    `2026-09-03-x-design.md`; `2026-9-03-widget-cache.md` beside
    `2026-09-03-widget-cache.md` on slug `cache` is `spec-ambiguous` (4.1,
    the documented malformed-date cost). Kills: grouping by filename instead of stem;
    restoring the longer-stem key (the :206 case still passes, so R1 adds the
    case `widget-cache` against stems `widget-cache-and-index` and
    `widget-cache-rev`, where the longer-stem key picks one and the new rule
    must say ambiguous).

### 9.2 Adversarial

A1. The dogfood shape. Branches `pr` and `fix/pr` against a specs directory
    holding `2026-10-01-prepare-release-notes-design.md`,
    `2026-10-02-improve-parser.md`, `2026-10-03-fix-pr-comment.md`,
    `2026-10-04-pr.md` and `2026-10-05-review-pr.md` (two stems containing
    `pr` inside a word, one containing `pr` as an interior whole token, one
    that IS `pr`, and one ending in `-pr`): `discoverSpec` returns `none` with
    `why` `no-usable-token`, and `legacy` names the file 0.10.0 chose (the
    exact `pr` stem). The `2026-10-04-pr.md` case pins open point 2: an exact
    stem made only of non-significant tokens selects nothing. Repeated
    through `prepareAgainstTrustBase` in a real temporary git repository with
    the specs committed on the base: a `no-contract` skip, nothing imported,
    no import-spec or freeze spawned (the spawn spy sees none), exit code 0,
    and report line 3 is the "chose a spec before conductor 0.11.0" string
    (5.4 rule 2: `legacy` is set and the outcome is `none`). Kills:
    restoring `includes`; `MIN_TOKEN_LENGTH` below 3; letting an exact stem
    select without a significant token; the trust-base path still calling
    `bestMatch`; printing string 2 only for some causes.
A2. Stop words only. `fix-docs-wip` against `fix-docs-wip-cleanup`, and
    `feature-release` against `feature-release-notes`: `none`,
    `no-usable-token`. Kills: removing any of `fix`, `docs`, `wip`,
    `feature`, `release` from the list (one assertion per word, so each
    removal is its own red).
A3. Ambiguous. `widget-cache` against `widget-cache-index` and
    `widget-cache-rev`: `none`, `ambiguous`, `tied` both, sorted. Through the
    run: a `spec-ambiguous` skip; the skipped line, the verdict (intent-only
    policy) and the summary clause use the `spec-ambiguous` wording; SARIF has
    `intent-guard/spec-ambiguous` with `tied`; report line 3 is the ambiguous
    string; the exit code is 0 and the token is `nothing-checked` (intent
    only) or `pass` (with a second clean gate); a local run without
    `--verbose` and with a second clean gate is NOT the one-line summary
    (5.3, `isFullyClean` consults `result.skipped`). Run twice: on the
    working tree, and through `prepareAgainstTrustBase` with the two specs
    committed on the base and an extra frozen-contract file added on the
    head, where the skip is `spec-ambiguous` (not `no-contract`), its detail
    names the base ref and both base files, never says the base has no spec
    for the branch, and the `headContractProposals` line is kept. Kills:
    choosing the longer stem; choosing the newest; choosing the first
    lexically; filing the skip under `no-contract`; the trust-base path
    falling through to the unconditional return at
    src/intent-prepare.ts:1309-1320; dropping the proposals on that return;
    `isFullyClean` ignoring skips.
A4. Weak, single token. `fix/cache-tuning` against `widget-cache` and
    `cache`: `cache` is a candidate (stem in slug), one significant token,
    `selected`, `weak`, `single-token`. Through a run with a clean intent
    stub: the text report is NOT the one-line summary; the gate block has the
    `match: weak` line naming `cache`; `--verbose` has the `chosen by` line;
    SARIF has `intent-guard/spec-weak-match`; report line 3 is the weak
    string and the Action copies it. Kills: no weak flag; the weak line not
    keeping the run off the summary; a missing notification; the header line
    missing.
A5. Weak by length. Slug `widget-rev-notes`, stems `widget` and `rev`: both
    single-token, `widget` wins on key 3, `weakBecause` holds both reasons,
    `runnerUp` is the `rev` file and the gate block names it. Kills:
    reporting the win as strong; omitting the runner-up; treating the
    length-only win as ambiguous (which the design rejects, 4.3).
A6. Head cannot add a candidate. A trust-base repository whose base has
    `widget-cache-index` and whose head adds `widget-cache` (exact for branch
    `feat/widget-cache`): the base's `widget-cache-index` is selected, strong
    (the slug is a run of its stem with two significant tokens), from the
    base text, and `widget-cache` is neither imported nor a candidate.
    No proposal line for the head's spec is expected: when the base selects
    a spec, a head-added spec is not proposed (today's behaviour, section 7).
    Kills: listing candidates from HEAD; reading the selected text from the
    working tree.
A7. The change from "selected" to "none" is visible and is never undone. A
    branch that 0.10.0 bound by substring now gets `none`: the skip detail
    has the legacy sentence, SARIF details carry `legacySelection`, report
    line 3 is the "chose a spec before" string, and a local run without
    `--verbose` is not the one-line summary. And `discoverSpec` returns
    `none` even though `legacy` is set. Run on the working tree and through
    `prepareAgainstTrustBase`, where the legacy clause is in the trust-base
    skip's detail. Kills: dropping the legacy clause on either path; falling
    back to `legacy` when the new rule finds nothing.
A8. Weak keeps its verdict. A weak selection whose intent stub blocks:
    exit 1, token `blocked (1)`, enforced. Under `enforce: false` exactly the
    existing not-enforced handling. Kills: any code path that downgrades a
    weak selection's enforcement or verdict.
A9. Explicit selectors bypass the rule. `--spec` naming `pr.md`, and a
    `Spec:` line naming `docs/superpowers/specs/2026-10-03-fix-pr-comment.md`
    on branch `pr`: each is imported, no `match` on the contract source, no
    weak line. Kills: applying the token rule to a named spec.
A10. Changed winner. Branch `feat/alpha-and-the-beta-gamma-omega` against
    stems `alpha-and-the-beta` (a run of the slug; two significant tokens,
    because `and` and `the` are stop words; 18 characters) and
    `beta-gamma-omega` (a run of the slug; three significant tokens; 16
    characters). Both are candidates under both rules. 0.10.0 chose the
    longer stem, `alpha-and-the-beta`; the new rule chooses
    `beta-gamma-omega` on count, `strong`, with `legacy` naming the other
    file. The gate block carries the changed-winner `note:` line of 5.2
    naming the 0.10.0 choice, SARIF details carry `legacySelection`, report
    line 3 is the "a different spec chosen than before conductor 0.11.0"
    string, and a local run without `--verbose` is not the one-line summary.
    Weak variant: branch `feat/gamma-omega` against stems `gamma` and
    `gamma-omegas-delta-long`. 0.10.0 chose `gamma-omegas-delta-long` (it
    contains `gamma-omega` as a raw substring, inside `omegas`, and is the
    longer stem). The new rule does not make it a candidate (`omega` is not
    `omegas`, so there is no whole-token run either way) and chooses `gamma`,
    `weak`, `single-token`, with `legacy` naming the other file. Report line
    3 is string 3, not string 4 (5.4 precedence), and the gate block carries
    both the weak `match:` line and the changed-winner `note:` line. Kills: no note line for a changed winner; the header
    line missing or printing the weak string instead; computing `legacy` but
    letting it decide the winner.


### 9.3 Surfaces

O1. Action summary (tests/action.test.ts harness): each of the four strings
    on line 3 is copied; on line 4 under a present-on-base line 3, both are
    copied in order; the same strings with a trailing `::error::x`, a leading
    space, a `\r::warning::y` tail, or on line 5 are not copied. Kills:
    reading a line other than 3 and 4; a prefix match instead of a whole-line
    match.
O2. Charset of printed words. Branch `` feat/`x`-cache `` (git allows a
    backtick in a ref name) against a spec stem `cache`, which is a run of
    the slug: the shared word printed is `cache`, and no backtick
    appears in the match line, the SARIF details or the header line. Kills:
    printing raw slug tokens.
O3. The `no-usable-token` sentence appears in the skip detail and the SARIF
    message for `pr`, and the `no-candidate` detail is byte-identical to
    0.10.0's. Kills: churning the ordinary adoption-ramp wording.
O4. One selector. A source-text test finds no reference to `stemMatches`
    or `bestMatch` in src/, and exactly two calls to `selectByBranch` in the
    selection paths plus one in the head-proposal path. Kills: a second
    selection rule growing back in one path.

### 9.4 Real artifacts

E1. Section 8.1's side-by-side table, committed as a fixture with the date
    and the four repositories' commit ids; a test replays the committed
    inputs through `selectByBranch` and asserts the committed outcomes, so a
    later rule change shows its diff against real names.

## 10. INVARIANTS.md changes

Each with its citation and test, in the form
scripts/check-invariant-citations.mjs reads:

- Amended, "Spec discovery: three sources, and the order is the whole
  decision": the candidacy paragraph becomes "The convention matches whole
  tokens, never a substring. Branch slug and spec stem have their ASCII
  letters lower-cased (no other character is folded, so no non-ASCII
  character can fold into a match) and are split on hyphen, underscore,
  slash and ASCII whitespace only (never Unicode whitespace); a spec is a
  candidate
  only when the shorter token sequence is one contiguous run of the longer
  and that run holds a significant token (three or more characters, letters
  digits and dots only, at least one letter, not a stop word). A slug with no
  significant token selects nothing." Tests U1 to U4, A1, A2. The ranking
  paragraph is rewritten to the three keys of 4.2 and drops the stem-length
  key. The citations to src/intent-spec.ts in that section are refreshed to
  the new lines.
- New, same section: "An ambiguous selection is reported, never guessed.
  When the top two stem groups tie on every ranking key, no spec is chosen,
  the gate is a `spec-ambiguous` skip on the working tree and at the trust
  base alike, and every tied spec is named." Test A3.
- New, same section: "A spec chosen by the branch name on one significant
  token, or by the token-length key alone, is selected and labelled weak in
  the gate block, the --verbose block, a SARIF note and the step summary; the
  label never changes its verdict or enforcement." Tests A4, A5, A8.
- New, same section: "On the normalisation tokens(x).join("-"), the token
  rule only removes bindings: every branch and spec pair that is a candidate
  is one the substring rule accepts on those normalised strings. On raw
  strings it gains exactly five kinds of pair and no others: ASCII case,
  underscore for hyphen, slash for hyphen, whitespace for hyphen, and
  doubled, leading or trailing delimiters. No non-ASCII character
  contributes." Test U5.
- New, same section: "One function, selectByBranch, makes the convention
  choice on the working tree and at the trust base." Test O4.
- New, under "The pull-request trust boundary": "The branch-name convention
  is a convenience, not a control against the pull request's author: the
  head branch name only chooses among the base's specs and the chosen text is
  the base's, but the author can equally choose any base spec, or none, with
  a Spec: line. A spec the head adds is never a candidate, and is reported
  as a proposal only when the base selects nothing. The control is a frozen
  native contract on the base." Test A6.
- New, "Reporting": "The intent-spec header line is one of four fixed
  strings and carries no repository text; the Action copies it only on a
  whole-line match on line 3 or 4." Test O1.
- New known-open, time-limited: "The legacy substring answer is computed for
  reporting only, until the release after 0.11.x removes it; it never
  decides a selection." Tests A7 and A10.

## 11. README and CHANGELOG

### 11.1 README, rule 4 (README.md:1182-1188)

Replaces the paragraph:

    4. A markdown file directly under docs/superpowers/specs whose name
       matches the branch on WHOLE WORDS. The branch slug is the branch name
       with its first segment (feat/, fix/) removed; a filename is reduced by
       stripping a YYYY-MM-DD- prefix and a trailing -design. Both have
       their ASCII letters lower-cased and are split into words on -, _, /
       and spaces. A spec is a
       candidate when one name's words appear, in order and together, inside
       the other's, and at least one shared word is three or more characters,
       contains a letter, and is not a common branch word (fix, feat, wip,
       docs, and the rest of the list in src/intent-spec.ts). Candidates are
       ranked by an equal name first, then the most shared words, then the
       longest shared word, then the lexically greatest filename among
       files with the same name (the newest date when every spec is dated
       YYYY-MM-DD-, so date every spec in that form). Two different specs that tie are NOT guessed between: the gate is
       skipped as intent-guard/spec-ambiguous, naming both. A spec chosen on
       one shared word, or on word length alone, is used and the report says
       the match is weak. Branch names like pr or fix/wip choose nothing.
       When the choice matters, say it: a Spec: line in the pull request
       body, or a branch named after the spec.

And one sentence after the "A branch with neither" paragraph: an ambiguous
branch lands in the same advisory state as a branch with no spec, under its
own id, and never reaches the exit code. The waiver paragraph
(README.md:1218-1224) gains: "The branch-name convention is not a control
either: whoever names the branch chooses among the base's specs."

### 11.2 CHANGELOG (Unreleased)

    ### Changed

    - **The intent gate's branch-name spec match is on whole words, not
      substrings.** A spec under docs/superpowers/specs is chosen for a
      branch only when one name's words appear, in order and together, in
      the other's, and at least one shared word has three or more
      characters, a letter, and is not a common branch word. Before this a
      branch called pr could be bound to any spec with "pr" inside a word,
      and the run reported that spec's verdict as the intent gate's. This is
      a behaviour change: a branch that matched only inside a word (pr in
      prepare, widget in widgets), a branch made only of short or common
      words (fix/pr, wip), and a branch that two specs match equally no
      longer choose a spec, and the report says so, including, for this
      release, which spec 0.10.0 would have chosen. To keep a binding, add
      a "Spec: <path>" line to the pull request body or name the branch
      after the spec. A repository that wants one contract whatever the
      branch is called should freeze a native contract on the base branch,
      which outranks every other source.
    - **A tie is reported, never guessed.** Two specs that match a branch
      equally are both named, and the gate is skipped as
      intent-guard/spec-ambiguous: advisory, like a branch with no spec, and
      never in the exit code. Previously the longer stem won.

    ### Added

    - **A weak match says so.** A spec chosen on one shared word, or on word
      length alone, is still used, and the report says the match is weak in
      the intent gate's block, the --verbose block, an
      intent-guard/spec-weak-match SARIF note and the Action's step summary,
      with how to pin it. Its verdict and enforcement are unchanged.

## 12. Open points, with the recommended default

1. Minimum token length. Recommended 3. It keeps `api`, `cli`, `osv`, and
   every token in the dogfood failure is 2. Raising it to 4 trades three
   letter domain words for nothing a measured case needs; revisit with the
   8.1 table.
2. An exact slug made only of non-significant tokens (`pr` against a spec
   named `...-pr.md`). Recommended: no selection (3.4), so the invariant is
   "nothing auto-selects without a significant token" with no exception.
   The cost is one adopter writing a `Spec:` line.
3. Ambiguous as could-not-run instead of a skip. Recommended: skip. It is
   the same state as no spec, which a written invariant keeps advisory, and
   the author can reach "no spec" by a `Spec: none` line anyway, so red here
   adds friction without adding a control. If a repository wants "a contract
   is required", that is a policy key this repository does not have today
   (section 2) and a separate design.
4. The legacy clause. Recommended: ship it in 0.11.x and remove it in the
   next minor, with its INVARIANTS known-open entry. It is the only way the
   "selected wrong spec" to "no spec" change is visible as a change rather
   than as a new state; it costs a private copy of the old function.
5. The stop list. Recommended: the list in 3.2, closed and test-pinned. The
   convention words (`design`, `spec`, `plan`, `review`) are the debatable
   ones; drop any the 8.1 table shows doing harm.
6. `branchSlug` dropping the first segment of every branch, including a
   first segment that is the feature (`widget/cache` gives `cache`).
   Recommended: unchanged here. With tokens it matters less (a stop-word
   prefix is ignored anyway), but changing it moves every binding again; a
   separate item if the 8.1 table shows a case.
7. Tokens outside `[a-z0-9.]` (non-Latin scripts, `+`). Recommended: never
   significant, as 3.2, and folding is ASCII-only (3.1) so no such
   character can become an ASCII letter first (CLOSED by ruling at review).
   Pinning by `Spec:` line is the remedy; widening the charset reopens what
   the report may print.
8. The plan pairing (`planFor`, equal `normalizeStem` strings). Recommended:
   unchanged, so case and underscore folding apply to spec choice only. A
   plan named `Widget_Cache.md` beside spec `widget-cache-design.md` stays
   unpaired, as today.
9. Release shape. Recommended: a minor release (0.11.0), because bindings
   change for existing adopters; the CHANGELOG entry above is written for
   that.

## 13. Review fix round

What changed from the first draft, per review item. The trust-boundary
argument and every code citation held at review and are unchanged.

- B1 (blocking, ruled). "Only removes bindings" was false as written: slash
  folding, whitespace, doubled or edge delimiters and non-Latin case folding
  (U+212A to `k`) also gained pairs. Folding is now ASCII-only (3.1), the
  property is stated against `tokens(x).join("-")` with its proof (3.3), the
  five raw-string gains are listed in 3.3, 7, 8 and the INVARIANTS line, and
  U5's corpus carries slashes, whitespace, doubled delimiters and the Kelvin
  sign.
- B2 (blocking, ruled). A6 no longer expects a head-spec proposal when the
  base selects a spec; section 7 states that a head-added spec is proposed
  only when the base selects nothing, which is today's behaviour, and no new
  proposal is designed.
- B3 (blocking). The trust-base ambiguous path is specified (5.1a): a
  `spec-ambiguous` skip keeping its proposals, naming the tied base files,
  with the legacy clause; `no-usable-token` and `no-candidate` keep the
  existing return with the new sentences appended. A3 and A7 run through
  both paths.
- N1 (ruled). The "chose a spec before" summary string prints whenever the
  outcome is `none` and `legacy` is set, whatever the cause (5.4); A1 now
  asserts it for the `pr` case.
- N2 (ruled). A fourth summary string for a changed winner, above the weak
  string in precedence, a changed-winner `note:` wording (5.2), and test A10.
- N3 (ruled). `isFullyClean` consults `result.skipped`: a `spec-ambiguous`
  skip or a skip carrying `legacy` keeps a local run off the one-line
  summary (5.3); asserted in A3 and A7.
- N4. "Lexically greatest filename", not "newest" (4.1, R1, README); the
  plain `.md` over `-design.md` order is stated; a malformed date is not
  stripped and can give a spurious advisory `spec-ambiguous` (4.1, R1).
- N5. 8.1 passes an explicit `--limit`, records the count per repository and
  repeats on a full page; the fixture passes the hygiene check, with any
  blocklisted name dropped and only the count of drops recorded.
- N6. A1 adds a stem that is exactly `pr` and one ending in `-pr`, pinning
  open point 2.
- N7. CHANGELOG says the longer stem won, not the longer filename.
- N8. No change now: the implementer refreshes the stale Spec discovery
  citations, as section 10 already says.

Second round (final; no further design review):

- Ruled: the delimiter class is ASCII only, `/[-_/ \t\n\r\f\v]+/`, because
  `\s` matches Unicode whitespace that git allows in a ref name and would let
  a U+00A0 create an exact binding (3.1 step 2, 3.3, the INVARIANTS line).
  U5 gains a U+00A0 case that must not bind, killing "restore `\s`".
- The edge-delimiter gain example `-widget-cache` was not a gain (raw
  `includes` already matched it); replaced by slug `widget-` against stem
  `big-widget` (3.3, U5).
- The fourth summary string now reads "before conductor 0.11.0", like the
  others (5.4, A10).
- A10's weak variant names concrete stems, `gamma` and
  `gamma-omegas-delta-long`, on branch `feat/gamma-omega`, so the new weak
  winner differs from the legacy one.

Implementation (mutation runs on the built tree):

- A1 does not kill "restoring includes" in candidacy alone: the `pr` slug
  returns `no-usable-token` before candidacy is reached, so that mutation is
  killed by U4 (`widget-caches`) and the A10 weak variant instead.
- O2 kills printing raw slug tokens as shared (measured red), but not
  dropping the 3.2 charset rule, because its backtick token is never in the
  shared run; U2's charset assertion kills that one.
