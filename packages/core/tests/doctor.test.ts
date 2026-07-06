import { describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { draftContract } from "../src/extract.js";
import { freezeContract, writeContract } from "../src/contract-store.js";
import { initConductor } from "../src/init.js";
import { runDoctor } from "../src/doctor.js";
import { writeIndex } from "../src/memory-index.js";

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "conductor-doctor-"));
}

function draft() {
  return draftContract({
    userText: "Add README usage documentation. Do not change source code. Verify the README includes the new note.",
  });
}

describe("runDoctor", () => {
  it("errors when Conductor is not initialized", () => {
    const result = runDoctor(tmpProject());
    expect(result.status).toBe("error");
    expect(result.exitCode).toBe(1);
    expect(result.findings.some((f) => f.id === "conductor_not_initialized")).toBe(
      true,
    );
  });

  it("errors when the active contract is still a draft", () => {
    const dir = tmpProject();
    initConductor(dir);
    writeContract(dir, draft());

    const result = runDoctor(dir);
    expect(result.status).toBe("error");
    expect(result.findings.some((f) => f.id === "active_contract_unfrozen")).toBe(
      true,
    );
  });

  it("passes a frozen initialized project with a current index", () => {
    const dir = tmpProject();
    initConductor(dir);
    writeContract(dir, freezeContract(draft(), { approvedBy: "tester" }));
    writeIndex(dir);

    const result = runDoctor(dir);
    expect(result.status).toBe("ok");
    expect(result.exitCode).toBe(0);
    expect(result.findings.some((f) => f.id === "active_contract_frozen")).toBe(
      true,
    );
    expect(result.findings.some((f) => f.id === "index_current")).toBe(true);
  });

  it("warns when the generated index is stale", () => {
    const dir = tmpProject();
    initConductor(dir);
    writeContract(dir, freezeContract(draft(), { approvedBy: "tester" }));
    writeFileSync(join(dir, ".conductor", "index.md"), "# stale\n", "utf8");

    const result = runDoctor(dir);
    expect(result.status).toBe("warn");
    expect(result.exitCode).toBe(0);
    expect(result.findings.some((f) => f.id === "index_stale")).toBe(true);
  });

  it("errors on invalid config", () => {
    const dir = tmpProject();
    initConductor(dir);
    writeFileSync(join(dir, ".conductor", "config.yaml"), "drift: [", "utf8");

    const result = runDoctor(dir);
    expect(result.status).toBe("error");
    expect(result.findings.some((f) => f.id === "config_invalid")).toBe(true);
  });

  it("reports existing non-Conductor hooks as warnings", () => {
    const dir = tmpProject();
    initConductor(dir);
    writeContract(dir, freezeContract(draft(), { approvedBy: "tester" }));
    mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
    writeFileSync(join(dir, ".git", "hooks", "pre-commit"), "npm test\n", "utf8");

    const result = runDoctor(dir);
    expect(result.status).toBe("warn");
    expect(
      result.findings.some((f) => f.id === "git_pre_commit_without_conductor"),
    ).toBe(true);
    expect(readFileSync(join(dir, ".git", "hooks", "pre-commit"), "utf8")).toBe(
      "npm test\n",
    );
  });

  it("warns when vault-guard config exists but the binary is not on PATH", () => {
    const dir = tmpProject();
    const binDir = join(dir, "bin");
    const previousPath = process.env.PATH;
    mkdirSync(binDir);
    process.env.PATH = binDir;

    try {
      initConductor(dir);
      writeContract(dir, freezeContract(draft(), { approvedBy: "tester" }));
      writeIndex(dir);
      writeFileSync(join(dir, ".vault-guard.json"), "{}\n", "utf8");

      const result = runDoctor(dir);
      expect(result.status).toBe("warn");
      expect(
        result.findings.some((f) => f.id === "vault_guard_config_present"),
      ).toBe(true);
      expect(
        result.findings.some((f) => f.id === "vault_guard_binary_missing"),
      ).toBe(true);
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("recognizes a combined Conductor and vault-guard pre-commit hook", () => {
    const dir = tmpProject();
    const binDir = join(dir, "bin");
    const previousPath = process.env.PATH;
    mkdirSync(binDir);
    const fakeVaultGuard = join(binDir, "vault-guard");
    writeFileSync(fakeVaultGuard, "#!/usr/bin/env sh\necho vault-guard 1.1.0\n", "utf8");
    chmodSync(fakeVaultGuard, 0o755);
    process.env.PATH = [binDir, previousPath ?? ""].filter(Boolean).join(delimiter);

    try {
      initConductor(dir);
      writeContract(dir, freezeContract(draft(), { approvedBy: "tester" }));
      writeIndex(dir);
      mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
      writeFileSync(
        join(dir, ".git", "hooks", "pre-commit"),
        "conductor-check --project . --staged\nvault-guard scan --staged\n",
        "utf8",
      );

      const result = runDoctor(dir);
      expect(result.status).toBe("ok");
      expect(
        result.findings.some((f) => f.id === "git_pre_commit_conductor"),
      ).toBe(true);
      expect(
        result.findings.some((f) => f.id === "git_pre_commit_vault_guard"),
      ).toBe(true);
      expect(
        result.findings.some((f) => f.id === "vault_guard_binary_found"),
      ).toBe(true);
    } finally {
      process.env.PATH = previousPath;
    }
  });
});
