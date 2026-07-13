# Stub detection retrospective — drift exit gate

**Contract:** `ic-20260315-stub01` (`examples/intent-contracts/stub-detection-retrospective.yaml`)  
**Scenario:** Stubbed notification (`println!`) and hardcoded metrics shipped instead of real implementations.

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
    "src-tauri/src/metrics.rs",
  ],
  signals: ["stub_println_notification", "hardcoded_metric_values"],
});
```

## Findings

1. Stub notification implementation conflicts with out_of_scope: *Stub implementations with println only*
2. Hardcoded metrics conflict with out_of_scope: *Hardcoded metric values*
3. Stub println notification signal conflicts with contract scope
4. Critical constraint violated: features must be functional, not stubbed
5. Hardcoded metric signal conflicts with contract scope
6. Hardcoded metrics diverge from acceptance criteria

## Would have caught

If this contract had been frozen before implementation, Conductor would have **soft-blocked** when drift detectors flagged stubbed notifications and hardcoded metrics against explicit out-of-scope items and the critical *functional, not stubbed* constraint.

## Exit gate

Automated gate: `packages/core/tests/stub-detection-retrospective.test.ts` asserts `overall >= 70` for this fixture.
