# Commander infra (AWS dev sandbox)

One CDK stack, `Commander`, in the dev sandbox account (profile `tire-rack-dev-sandbox-developer`, us-east-1):

- CloudFront (default `*.cloudfront.net` certificate, so HTTPS/WSS with no domain) in front of
- an ALB (idle timeout 1 hour; only accepts CloudFront's IP ranges plus a secret header) in front of
- one ECS Fargate task (ARM64, 0.25 vCPU, 512 MB) running the game server, which also serves the page.
- The task role may only call `bedrock:InvokeModel` on Claude Haiku 4.5 via the `us.` inference profile.
- Logs are kept one week. Alerts: a $10/month budget on Haiku spend, an hourly token-spend alarm, and a
  health alarm, all emailed to `alertEmail` (confirm the SNS subscription email once).
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

The first run writes `deploy.local.json` (gitignored) with a random origin secret and access code.
Edit it to set `alertEmail`, change `accessCode` (set it to `""` to run without one), or set
`modelCallsPerDay` / `modelBudgetUsd`. The link to hand out is `PlayUrl`; it carries `?code=`.

Smoke test after a deploy, from `server/`:

```sh
node scripts/prompt-smoke.mjs "wss://<distribution>.cloudfront.net/ws?code=<accessCode>"
```

A redeploy restarts the single task, which drops any live games (all game state is in memory).
