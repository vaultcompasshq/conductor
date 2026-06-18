# NetViz Retrospective — Drift Exit Gate

**Contract:** `ic-20260315-nviz01` (`examples/intent-contracts/netviz-retrospective.yaml`)  
**Scenario:** Turn ~40 — stubbed notification (`println!`) and hardcoded safety scores shipped instead of real implementations.

## Drift score

| Metric | Value |
|--------|-------|
| **Overall** | **83** |
| **Action** | `soft_block` |
| scope_creep | 100 |
| constraint_violation | 90 |
| ac_divergence | 80 |
| undocumented_pivot | 0 |

## Input signals

```typescript
scoreDrift(contract, {
  changedPaths: [
    "src-tauri/src/notification_system.rs",
    "src-tauri/src/safety_score.rs",
  ],
  signals: ["stub_println_notification", "hardcoded_safety_score"],
});
```

## Findings

1. Stub notification implementation conflicts with out_of_scope: *Stub implementations with println only*
2. Hardcoded safety score conflicts with out_of_scope: *Hardcoded safety score values*
3. Stub println notification signal conflicts with contract scope
4. Critical constraint violated: features must be functional, not stubbed
5. Hardcoded safety score signal conflicts with contract scope
6. Hardcoded safety score diverges from acceptance criteria

## Would have caught

If this contract had been frozen before implementation, Conductor would have **soft-blocked** the session when drift detectors flagged:

- **`notification_system.rs`** changing while `stub_println_notification` was present — scope creep against explicit out-of-scope stub/println work, plus violation of the critical *“All features must be functional, not stubbed”* constraint.
- **`safety_score.rs`** changing while `hardcoded_safety_score` was present — scope creep against hardcoded values and divergence from **ac-2** (*Safety scores derived from live metrics, not constants*).

The user would have seen a soft block (score 83 ≥ 71) with options to revert stubbed code, log a documented pivot, or override with reason — instead of discovering non-functional notifications and fake safety scores at review time.

## Exit gate

Automated gate: `packages/core/tests/netviz-retrospective.test.ts` asserts `overall >= 70` for this retrospective fixture. Phase 1 is not complete until this test passes in CI.
