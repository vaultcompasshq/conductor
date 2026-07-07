#!/usr/bin/env node
import { stringify } from "yaml";
import {
  importSpecContract,
  loadAllConstraints,
  writeContract,
} from "@vaultcompass/conductor-core";

function usage(): never {
  console.error(
    [
      "Usage: conductor-import-spec [--project <root>] [--from auto|spec-kit|kiro]",
      "       [--spec-dir <dir>] [--requirements <path>] [--design <path>]",
      "       [--tasks <path>] [--dry-run]",
    ].join(" "),
  );
  process.exit(1);
}

function parseArgs(argv: string[]) {
  let projectRoot = ".";
  let format: "auto" | "spec-kit" | "kiro" = "auto";
  let specDir = "";
  let requirementsPath = "";
  let designPath = "";
  let tasksPath = "";
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--project" && argv[i + 1]) {
      projectRoot = argv[++i];
    } else if (arg === "--from" && argv[i + 1]) {
      const next = argv[++i];
      if (next !== "auto" && next !== "spec-kit" && next !== "kiro") usage();
      format = next;
    } else if (arg === "--spec-dir" && argv[i + 1]) {
      specDir = argv[++i];
    } else if (arg === "--requirements" && argv[i + 1]) {
      requirementsPath = argv[++i];
    } else if (arg === "--design" && argv[i + 1]) {
      designPath = argv[++i];
    } else if (arg === "--tasks" && argv[i + 1]) {
      tasksPath = argv[++i];
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else {
      usage();
    }
  }

  return {
    projectRoot,
    format,
    specDir: specDir || undefined,
    requirementsPath: requirementsPath || undefined,
    designPath: designPath || undefined,
    tasksPath: tasksPath || undefined,
    dryRun,
  };
}

const args = parseArgs(process.argv.slice(2));

try {
  const imported = importSpecContract(args.projectRoot, {
    format: args.format,
    specDir: args.specDir,
    requirementsPath: args.requirementsPath,
    designPath: args.designPath,
    tasksPath: args.tasksPath,
  });

  const loaded = loadAllConstraints(args.projectRoot);
  const contract = {
    ...imported.contract,
    constraints: loaded.constraints,
  };

  const writtenPath = args.dryRun ? null : writeContract(args.projectRoot, contract);
  console.log(
    JSON.stringify({
      valid: true,
      format: imported.format,
      spec_dir: imported.specDir,
      imported_files: imported.files.map((file) => ({
        role: file.role,
        path: file.path,
      })),
      written_path: writtenPath,
      frozen: false,
      next_step: "Review the imported draft, then approve with: conductor freeze --project <root> --approved-by <name>",
      loaded_constraint_files: loaded.loadedFiles,
      contract_yaml: stringify(contract),
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
