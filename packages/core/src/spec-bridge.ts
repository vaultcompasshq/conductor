import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { IntentContract } from "@vaultcompasshq/conductor-schema";
import { draftContract } from "./extract.js";

export type SpecBridgeFormat = "auto" | "spec-kit" | "kiro";

export interface SpecBridgeFile {
  role: "requirements" | "design" | "tasks";
  path: string;
  content: string;
}

export interface ImportSpecOptions {
  format?: SpecBridgeFormat;
  specDir?: string;
  requirementsPath?: string;
  designPath?: string;
  tasksPath?: string;
}

export interface ImportedSpecContract {
  format: Exclude<SpecBridgeFormat, "auto">;
  specDir: string;
  files: SpecBridgeFile[];
  contract: IntentContract;
}

const SPEC_KIT_FILES = {
  requirements: "spec.md",
  design: "plan.md",
  tasks: "tasks.md",
} as const;

const KIRO_FILES = {
  requirements: "requirements.md",
  bugfix: "bugfix.md",
  design: "design.md",
  tasks: "tasks.md",
} as const;

function isDir(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function firstExisting(paths: string[]): string | undefined {
  return paths.find((path) => existsSync(path));
}

function newestDirectory(paths: string[]): string | undefined {
  const dirs = paths.filter(isDir);
  if (dirs.length === 0) return undefined;
  return dirs
    .map((path) => ({ path, mtime: statSync(path).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0].path;
}

function discoverSpecKitDir(projectRoot: string): string | undefined {
  const specsRoot = join(projectRoot, "specs");
  const specifySpecsRoot = join(projectRoot, ".specify", "specs");

  if (isDir(specsRoot)) {
    const children = readdirSync(specsRoot).map((name) => join(specsRoot, name));
    const newest = newestDirectory(children);
    if (newest) return newest;
  }

  if (isDir(specifySpecsRoot)) {
    const children = readdirSync(specifySpecsRoot).map((name) =>
      join(specifySpecsRoot, name),
    );
    const newest = newestDirectory(children);
    if (newest) return newest;
  }

  return undefined;
}

function discoverKiroDir(projectRoot: string): string | undefined {
  const specsRoot = join(projectRoot, ".kiro", "specs");
  if (!isDir(specsRoot)) return undefined;
  const children = readdirSync(specsRoot).map((name) => join(specsRoot, name));
  return newestDirectory(children);
}

function resolvePath(projectRoot: string, path: string): string {
  return path.startsWith("/") ? path : join(projectRoot, path);
}

function readOptional(role: SpecBridgeFile["role"], path?: string): SpecBridgeFile | null {
  if (!path || !existsSync(path)) return null;
  return {
    role,
    path,
    content: readFileSync(path, "utf8"),
  };
}

function discoverFormat(projectRoot: string, options: ImportSpecOptions): {
  format: Exclude<SpecBridgeFormat, "auto">;
  specDir: string;
} {
  if (options.specDir) {
    const specDir = resolvePath(projectRoot, options.specDir);
    const format =
      options.format && options.format !== "auto"
        ? options.format
        : existsSync(join(specDir, SPEC_KIT_FILES.requirements))
          ? "spec-kit"
          : "kiro";
    return { format, specDir };
  }

  if (options.format === "spec-kit") {
    const specDir = discoverSpecKitDir(projectRoot);
    if (!specDir) throw new Error("No Spec Kit spec directory found");
    return { format: "spec-kit", specDir };
  }

  if (options.format === "kiro") {
    const specDir = discoverKiroDir(projectRoot);
    if (!specDir) throw new Error("No Kiro spec directory found");
    return { format: "kiro", specDir };
  }

  const specKitDir = discoverSpecKitDir(projectRoot);
  if (specKitDir) return { format: "spec-kit", specDir: specKitDir };

  const kiroDir = discoverKiroDir(projectRoot);
  if (kiroDir) return { format: "kiro", specDir: kiroDir };

  throw new Error("No supported spec artifacts found");
}

function readSpecKitFiles(
  projectRoot: string,
  specDir: string,
  options: ImportSpecOptions,
): SpecBridgeFile[] {
  return [
    readOptional(
      "requirements",
      options.requirementsPath
        ? resolvePath(projectRoot, options.requirementsPath)
        : join(specDir, SPEC_KIT_FILES.requirements),
    ),
    readOptional(
      "design",
      options.designPath
        ? resolvePath(projectRoot, options.designPath)
        : join(specDir, SPEC_KIT_FILES.design),
    ),
    readOptional(
      "tasks",
      options.tasksPath
        ? resolvePath(projectRoot, options.tasksPath)
        : join(specDir, SPEC_KIT_FILES.tasks),
    ),
  ].filter((file): file is SpecBridgeFile => file != null);
}

function readKiroFiles(
  projectRoot: string,
  specDir: string,
  options: ImportSpecOptions,
): SpecBridgeFile[] {
  const requirementsPath =
    options.requirementsPath != null
      ? resolvePath(projectRoot, options.requirementsPath)
      : firstExisting([
          join(specDir, KIRO_FILES.requirements),
          join(specDir, KIRO_FILES.bugfix),
        ]);

  return [
    readOptional("requirements", requirementsPath),
    readOptional(
      "design",
      options.designPath
        ? resolvePath(projectRoot, options.designPath)
        : join(specDir, KIRO_FILES.design),
    ),
    readOptional(
      "tasks",
      options.tasksPath
        ? resolvePath(projectRoot, options.tasksPath)
        : join(specDir, KIRO_FILES.tasks),
    ),
  ].filter((file): file is SpecBridgeFile => file != null);
}

function stripMarkdown(content: string): string {
  return content
    .split("\n")
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, "")
        .replace(/^[-*]\s+\[[ xX]\]\s+/, "- ")
        .replace(/^[-*]\s+/, "- ")
        .replace(/`([^`]+)`/g, "$1")
        .trim(),
    )
    .filter((line) => line.length > 0)
    .join("\n");
}

function buildImportText(
  format: Exclude<SpecBridgeFormat, "auto">,
  specDir: string,
  files: SpecBridgeFile[],
): string {
  const parts = [
    `Import ${format} spec "${basename(specDir)}" into a Conductor Intent Contract.`,
  ];

  for (const file of files) {
    const label =
      file.role === "requirements"
        ? "Requirements"
        : file.role === "design"
          ? "Design"
          : "Tasks";
    parts.push(`${label}:\n${stripMarkdown(file.content)}`);
  }

  parts.push(
    "Human review is required before freeze. Do not treat the imported contract as approved.",
  );
  return parts.join("\n\n");
}

export function importSpecContract(
  projectRoot: string,
  options: ImportSpecOptions = {},
): ImportedSpecContract {
  const discovered = discoverFormat(projectRoot, options);
  const files =
    discovered.format === "spec-kit"
      ? readSpecKitFiles(projectRoot, discovered.specDir, options)
      : readKiroFiles(projectRoot, discovered.specDir, options);

  if (files.length === 0) {
    throw new Error(`No readable spec files found in ${discovered.specDir}`);
  }

  const userText = buildImportText(discovered.format, discovered.specDir, files);
  return {
    ...discovered,
    files,
    contract: draftContract({ userText }),
  };
}
