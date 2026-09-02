/**
 * ts-jest in ESM mode, mirroring the configuration dep-guard uses so the
 * family's repositories keep one test story rather than three.
 *
 * testMatch rather than roots: `roots` requires the listed directories to
 * exist on disk, and a fresh clone with no tests yet would fail Jest's
 * directory check before --passWithNoTests could apply.
 *
 * Tests type-check against tsconfig.test.json. tsconfig.base.json targets
 * "NodeNext" for real Node module resolution in the published output, and
 * that hybrid module kind forces ts-jest into transpile-only mode;
 * tsconfig.test.json swaps in a plain ES2022 module target, which Jest is
 * happy with and which keeps strict mode from the shared base config.
 *
 * The gap worth knowing about, inherited from the same setup: ts-jest 29.x
 * never surfaces type diagnostics as failures on the ESM transform path, so
 * `pnpm test` alone will not catch a strict-mode violation in a test file.
 * `pnpm typecheck` is what enforces that.
 */
export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "<rootDir>/tsconfig.test.json",
      },
    ],
  },
  // src/ and tests/ hold TypeScript. scripts/ holds plain ESM tooling that
  // runs under node with no build step, so its tests are .mjs and execute
  // as native modules. One config so `pnpm test` stays the single answer to
  // "did I break anything".
  testMatch: [
    "<rootDir>/tests/**/*.test.ts",
    "<rootDir>/scripts/tests/**/*.test.mjs",
  ],
  testTimeout: 30000,
};
