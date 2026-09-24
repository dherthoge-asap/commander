// Cross-platform test runner: finds every *.test.ts under src/ and runs each one with node:test via tsx.
// (Shell globs like src/**/*.test.ts don't recurse in sh and don't expand at all on Windows.)
//
// Each file runs as its own plain `node` process rather than under `node --test`. The AI strategy
// tests log heavily, and on Node 20 that output can corrupt `node --test`'s serialized channel to
// its child ("Unable to deserialize cloned data"), failing or hanging the run at random.
// A TAP copy of each file's results goes to a temp file so we can total the counts.
import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
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
const tapDir = mkdtempSync(join(tmpdir(), 'commander-tests-'));
const totals = { tests: 0, pass: 0, fail: 0 };
const failedFiles = [];

try {
  files.forEach((file, i) => {
    const tapFile = join(tapDir, `${i}.tap`);
    const result = spawnSync(
      process.execPath,
      [
        '--import', 'tsx',
        '--test-reporter=spec', '--test-reporter-destination=stdout',
        '--test-reporter=tap', `--test-reporter-destination=${tapFile}`,
        ...extra,
        file
      ],
      { cwd: serverDir, stdio: 'inherit' }
    );

    let tap = '';
    try { tap = readFileSync(tapFile, 'utf8'); } catch { /* file crashed before reporting */ }
    const count = name => Number(tap.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1] ?? 0);
    totals.tests += count('tests');
    totals.pass += count('pass');
    totals.fail += count('fail');

    if (result.status !== 0) failedFiles.push(relative(serverDir, file));
  });
} finally {
  rmSync(tapDir, { recursive: true, force: true });
}

console.log('\n==============================');
console.log(`files ${files.length}  tests ${totals.tests}  pass ${totals.pass}  fail ${totals.fail}`);
if (failedFiles.length) {
  console.log(`failed files:\n  ${failedFiles.join('\n  ')}`);
  process.exit(1);
}
