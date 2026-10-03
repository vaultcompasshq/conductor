// The workflow that runs conductor on itself, read as a file. A workflow is
// only proven by its first hosted run; what can be proven here is the shape
// that makes it safe to run on every pull request: read-only token, no
// secrets, every third-party action pinned by full commit SHA, and the one
// local-path reference to this action that the repository's docs say exists.

import { describe, expect, it } from '@jest/globals';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');

interface Step {
  name?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
}
interface Workflow {
  on: unknown;
  permissions?: Record<string, string>;
  jobs: Record<string, { permissions?: Record<string, string>; steps: Step[] }>;
}

function load(file: string): { text: string; workflow: Workflow } {
  const text = readFileSync(path.join(WORKFLOWS, file), 'utf8');
  return { text, workflow: parseYaml(text) as Workflow };
}

describe('the self-check workflow', () => {
  const { text, workflow } = load('self-check.yml');
  const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);

  it('runs on pull_request only, with a read-only token and no secrets', () => {
    expect(workflow.on).toEqual({ pull_request: null });
    expect(workflow.permissions).toEqual({ contents: 'read' });
    for (const job of Object.values(workflow.jobs)) {
      expect(job.permissions).toBeUndefined();
    }
    expect(text).not.toMatch(/secrets\./);
    expect(text).not.toMatch(/GH_TOKEN|GITHUB_TOKEN/);
  });

  it('pins every third-party action by full commit SHA', () => {
    const external = steps.map((step) => step.uses).filter((uses): uses is string => uses !== undefined && !uses.startsWith('./'));
    expect(external.length).toBeGreaterThan(0);
    for (const uses of external) {
      expect(uses).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    }
  });

  it('runs this repository action from the checkout, advisory, over full history', () => {
    const local = steps.filter((step) => step.uses === './');
    expect(local).toHaveLength(1);
    expect(local[0]?.with).toEqual({ advisory: 'true' });
    const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with).toEqual({ 'fetch-depth': 0 });
  });

  it('is the only workflow that references the action with ./', () => {
    for (const file of readdirSync(WORKFLOWS)) {
      const { workflow: other } = load(file);
      const local = Object.values(other.jobs)
        .flatMap((job) => job.steps)
        .filter((step) => step.uses === './');
      expect([file, local.length]).toEqual([file, file === 'self-check.yml' ? 1 : 0]);
    }
  });
});
