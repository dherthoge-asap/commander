// Cross-platform test runner: finds every *.test.ts under src/ and runs it with node:test via tsx.
// (Shell globs like src/**/*.test.ts don't recurse in sh and don't expand at all on Windows.)
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');

function findTests(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return findTests(full);
    return entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

const files = findTests(join(serverDir, 'src')).sort();
const extra = process.argv.slice(2);
const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', '--test-reporter=spec', ...extra, ...files],
  { cwd: serverDir, stdio: 'inherit' }
);
process.exit(result.status ?? 1);
