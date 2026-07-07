---
name: capture-correction
description: >-
  Capture a user correction as a durable rule on the Intent Contract, and emit a
  clean Session Brief to re-establish context. Use when the user corrects a
  mistake the agent made — especially a repeat mistake — so the lesson survives
  context compaction instead of staying buried in the transcript.
---

# Capture Correction + Session Brief

**Announce at start:** "I'm using the capture-correction skill to record this lesson."

## When to run

- The user corrects an approach the agent took ("no, don't do X — do Y").
- The agent is about to repeat a mistake already corrected this session.
- A new session or post-compaction resume: load the brief instead of replaying
  the messy history.

## Why

A correction left as a chat message is lost on compaction, and while it stays in
context the model can re-read its own failed attempt and repeat it. Promoting it
to a durable rule turns a landmine into a warning sign.

## Capture a correction (helper CLI)

```bash
conductor-correct --project /path/to/project \
  --wrong "fetched data inside the component" \
  --right "use a useThemePreference hook" \
  --rule "Never fetch in components; use a hook" \
  --acknowledge   # user confirmed (authoritative); omit for a pending proposal
  # --promote      # also add to constraints[] so drift-guard enforces it
```

- Without `--acknowledge` the entry is `pending` (agent-proposed). Only the user
  confirms.
- `--promote` (requires `--acknowledge`) mirrors the lesson into `constraints[]`
  as a `user-correction` rule — re-violating it then scores as drift via the
  existing scorer. Off by default.

## Emit the Session Brief

```bash
conductor-brief --project /path/to/project          # markdown
conductor-brief --project /path/to/project --json    # machine-readable
```

The brief is the minimal correct-methodology context: intent, scope, acceptance
criteria, critical/high constraints, and **acknowledged** corrections — and no
failed code. Re-inject this after a context reset instead of the transcript.

## Boundary

Conductor produces the brief; it cannot edit the model's context window — that
is the harness's job. Load the brief; let the harness drop the noise.

## Implementation

`packages/core/src/correction.ts` (capture/promote) and
`packages/core/src/brief.ts` (render). Schema: `correction_log` in
`@vaultcompass/conductor-schema`. Design:
`docs/superpowers/specs/2026-06-20-correction-log-and-brief.md`.
