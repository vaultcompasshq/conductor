#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedVersion = "0.3.0-beta.0";

const packages = [
  {
    dir: "packages/schema",
    name: "@vaultcompasshq/conductor-schema",
    requiredFiles: [
      "package/dist/index.js",
      "package/dist/intent-contract.schema.json",
    ],
  },
  {
    dir: "packages/core",
    name: "@vaultcompasshq/conductor-core",
    requiredFiles: ["package/dist/index.js"],
  },
  {
    dir: "packages/skill",
    name: "@vaultcompasshq/conductor-skill",
    requiredFiles: [
      "package/dist/check-cli.js",
      "package/dist/resume-cli.js",
      "package/intent-contract/SKILL.md",
      "package/drift-guard/SKILL.md",
    ],
  },
  {
    dir: "packages/cli",
    name: "@vaultcompasshq/conductor-cli",
    requiredFiles: ["package/dist/conductor.js"],
  },
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertPublishableManifest(pkg) {
  const manifest = readJson(join(root, pkg.dir, "package.json"));

  if (manifest.name !== pkg.name) {
    throw new Error(`${pkg.dir}: expected package name ${pkg.name}`);
  }

  if (manifest.private) {
    throw new Error(`${pkg.name}: package is still marked private`);
  }

  if (manifest.version !== expectedVersion) {
    throw new Error(
      `${pkg.name}: expected version ${expectedVersion}, got ${manifest.version}`,
    );
  }
}

function assertNoWorkspaceDeps(pkgName, packedManifest) {
  for (const section of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    const deps = packedManifest[section] ?? {};
    for (const [name, range] of Object.entries(deps)) {
      if (String(range).startsWith("workspace:")) {
        throw new Error(`${pkgName}: packed ${section}.${name} still uses ${range}`);
      }
    }
  }
}

function packPackage(pkg, destination) {
  const before = new Set(readdirSync(destination));
  execFileSync(
    "pnpm",
    ["--dir", join(root, pkg.dir), "pack", "--pack-destination", destination],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  const added = readdirSync(destination).filter(
    (file) => !before.has(file) && file.endsWith(".tgz"),
  );
  if (added.length !== 1) {
    throw new Error(`${pkg.name}: expected one tarball, found ${added.length}`);
  }
  return join(destination, added[0]);
}

function tarList(tarball) {
  return execFileSync("tar", ["-tf", tarball], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function readPackedManifest(tarball) {
  const raw = execFileSync("tar", ["-xOf", tarball, "package/package.json"], {
    encoding: "utf8",
  });
  return JSON.parse(raw);
}

const destination = mkdtempSync(join(tmpdir(), "conductor-release-smoke-"));

try {
  for (const pkg of packages) {
    assertPublishableManifest(pkg);
    const tarball = packPackage(pkg, destination);
    const files = new Set(tarList(tarball));

    for (const required of pkg.requiredFiles) {
      if (!files.has(required)) {
        throw new Error(`${pkg.name}: packed tarball missing ${required}`);
      }
    }

    const packedManifest = readPackedManifest(tarball);
    assertNoWorkspaceDeps(pkg.name, packedManifest);
    console.log(`ok ${pkg.name} -> ${tarball}`);
  }
} finally {
  rmSync(destination, { recursive: true, force: true });
}
