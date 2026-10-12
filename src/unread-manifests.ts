// Which tracked manifest-like files were NOT handed to the external scanner.
//
// This scans nothing and decides nothing, and it claims nothing about what
// any other gate reads: it measures one thing, the files this gate was not
// given. A repository whose only manifests are a pyproject.toml, a Dockerfile
// and a workflow gets a green vulnerabilities gate that looked at none of
// them, and "treated as clean" on its own reads as a statement about the code.

const EXACT_NAMES = new Set([
  'pyproject.toml',
  'Pipfile',
  'setup.py',
  'go.mod',
  'go.sum',
  'Cargo.toml',
  'Gemfile',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Package.swift',
  'Podfile',
  'compose.yml',
  'compose.yaml',
]);

const MAX_LISTED = 12;
const SKIPPED_DIRS = new Set(['node_modules', 'vendor', 'testdata']);

function isManifest(file: string): boolean {
  const base = file.slice(file.lastIndexOf('/') + 1);
  return (
    EXACT_NAMES.has(base) ||
    /^requirements.*\.txt$/.test(base) ||
    /^Dockerfile(\..+)?$/.test(base) ||
    /^docker-compose.*\.ya?ml$/.test(base) ||
    (file.startsWith('.github/workflows/') && /\.ya?ml$/.test(base))
  );
}

/**
 * Tracked manifest-like files that were not handed to `product`, sorted, as
 * one sentence fragment, or null when there are none.
 *
 * `handed` are the repository-relative paths the gate was actually handed,
 * so a file it does read is never listed. By path rather than by base name,
 * because the vulnerabilities gate hands a requirements file only when it
 * passes the pin check (src/osv-coverage.ts): an unpinned requirements.txt
 * is not read even when another requirements.txt is, and is listed. go.mod
 * and a pinned requirements file are handed, so they leave this list.
 * Vendored and testdata directories are skipped like node_modules: they are
 * not this repository's own manifests.
 */
export function unreadManifestsNote(
  tracked: readonly string[],
  handed: ReadonlySet<string>,
  product: string
): string | null {
  const unread = tracked
    .filter((file) => !file.split('/').some((segment) => SKIPPED_DIRS.has(segment)))
    .filter((file) => !handed.has(file))
    .filter(isManifest)
    .sort();
  if (unread.length === 0) {
    return null;
  }
  const listed = unread.slice(0, MAX_LISTED).join(', ');
  const more = unread.length > MAX_LISTED ? `, and ${unread.length - MAX_LISTED} more` : '';
  return `Tracked manifests not handed to ${product}: ${listed}${more}.`;
}
