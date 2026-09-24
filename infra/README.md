# Commander infra (AWS dev sandbox)

One CDK stack, `Commander`, in the dev sandbox account (profile `tire-rack-dev-sandbox-developer`, us-east-1):

- CloudFront (default `*.cloudfront.net` certificate, so HTTPS/WSS with no domain) in front of
- an ALB (idle timeout 1 hour; only accepts CloudFront's IP ranges plus a secret header) in front of
- one ECS Fargate task (ARM64, 0.25 vCPU, 512 MB) running the game server, which also serves the page.
- The task role may only call `bedrock:InvokeModel` on Claude Haiku 4.5 via the `us.` inference profile.
- Logs are kept one week. Alerts: an alarm when Commander makes over 1000 model calls in an hour (about $2 of
  Haiku, counted from its own logs) and a health alarm, all emailed to `alertEmail` (confirm the SNS subscription email once).
- Every resource is tagged `project=commander`, `delete-after=2026-10-16`.

## Commands (macOS, Linux or Windows; needs Node 20+ and Docker running)

```sh
cd infra
npm install
aws sso login --profile tire-rack-dev-sandbox-developer   # if your session expired
npm run deploy     # build the image, deploy, write cdk-outputs.json (PlayUrl, WsUrl)
npm run destroy    # tear everything down
npm test           # synth assertions, no AWS calls
```

The wrapper always uses the `tire-rack-dev-sandbox-developer` profile (set `COMMANDER_AWS_PROFILE` to
override), ignoring any `AWS_PROFILE` in your shell, and the stack is pinned to the sandbox account
(182399717497), so CDK refuses to deploy with credentials for any other account.

The first run writes `deploy.local.json` (gitignored) with a random origin secret and access code.
Edit it to set `alertEmail`, change `accessCode` (set it to `""` to run without one), or set
`modelCallsPerDay`. The link to hand out is `PlayUrl`; it carries `?code=`.

`modelCallsPerDay` starts at 300 (about $0.60 of Haiku) so testing days can't add up past the $10
event envelope. It is the spend control: there is no AWS Budget, because Bedrock's billing line and
token metrics count every Haiku call in the sandbox account, and this linked account can't activate
cost allocation tags to narrow them to Commander. Raise it to 3000 and `npm run deploy` on 10/14, the day before the event.

Smoke test after a deploy, from `server/`:

```sh
node scripts/prompt-smoke.mjs "wss://<distribution>.cloudfront.net/ws?code=<accessCode>"
```

`npm run destroy` removes every stack resource, including the log group and alarms. The container
images pushed to the CDK bootstrap's shared ECR repo (`cdk-hnb659fds-container-assets-*`) are not
part of the stack; delete them by tag afterwards (RESULT notes the command).

A redeploy restarts the single task, which drops any live games (all game state is in memory).
