#!/usr/bin/env node
// Values come from scripts/cdk.mjs (which keeps them in the gitignored deploy.local.json), passed as -c context.
import * as cdk from 'aws-cdk-lib';
import { CommanderStack } from '../lib/commander-stack.js';

const app = new cdk.App();
const ctx = (key: string): string | undefined => app.node.tryGetContext(key) || undefined;

const originSecret = ctx('originSecret');
if (!originSecret) throw new Error('Missing -c originSecret=...; run through `npm run synth|deploy|destroy`');

const stack = new CommanderStack(app, 'Commander', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
  description: 'Commander game (Remote to TR breakout 10/15/2026): Fargate + ALB + CloudFront, Haiku 4.5 on Bedrock',
  originSecret,
  accessCode: ctx('accessCode'),
  alertEmail: ctx('alertEmail'),
  modelCallsPerDay: Number(ctx('modelCallsPerDay') ?? 3000),
  modelBudgetUsd: Number(ctx('modelBudgetUsd') ?? 10),
});

cdk.Tags.of(stack).add('project', 'commander');
cdk.Tags.of(stack).add('owner', 'dherthoge');
cdk.Tags.of(stack).add('purpose', 'remote-tr-breakout-2026-10-15');
cdk.Tags.of(stack).add('delete-after', '2026-10-16');
