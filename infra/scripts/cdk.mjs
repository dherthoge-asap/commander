// Cross-platform wrapper around the CDK CLI: `node scripts/cdk.mjs synth|deploy|diff|destroy [extra cdk args]`.
// Keeps the per-deploy values (origin secret, access code, alert email) in deploy.local.json, which is
// gitignored, creating it with random values the first time. Uses the dev sandbox SSO profile unless
// AWS_PROFILE is already set.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const infraDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const configFile = join(infraDir, 'deploy.local.json');
const [command = 'synth', ...extra] = process.argv.slice(2);

const code = () => Array.from(randomBytes(6), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : {};
config.originSecret ??= randomBytes(24).toString('hex');
config.accessCode ??= code(); // set to "" to run without an access code
config.alertEmail ??= process.env.COMMANDER_ALERT_EMAIL || '';
writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');

const context = Object.entries(config)
  .filter(([, value]) => value !== '' && value !== undefined && value !== null)
  .flatMap(([key, value]) => ['-c', `${key}=${value}`]);

const env = { ...process.env, AWS_PROFILE: process.env.AWS_PROFILE || 'tire-rack-dev-sandbox-developer', AWS_REGION: 'us-east-1' };
const args = ['cdk', command, ...context];
if (command === 'deploy') args.push('--require-approval', 'never', '--outputs-file', 'cdk-outputs.json');
if (command === 'destroy') args.push('--force');
args.push(...extra);

const result = spawnSync('npx', args, { cwd: infraDir, env, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
