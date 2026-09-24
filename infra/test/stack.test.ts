// Synth the stack with a registry image (no Docker) and check the parts that matter for cost and safety.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { CommanderStack } from '../lib/commander-stack.js';

function synth(props: Partial<ConstructorParameters<typeof CommanderStack>[2]> = {}) {
  const app = new cdk.App();
  const stack = new CommanderStack(app, 'Test', {
    env: { account: '111111111111', region: 'us-east-1' },
    originSecret: 'secret-value',
    accessCode: 'ABC123',
    alertEmail: 'alerts@example.com',
    image: ecs.ContainerImage.fromRegistry('node:20-slim'),
    ...props,
  });
  return Template.fromStack(stack);
}

test('task role can only invoke Haiku 4.5 through the inference profile', () => {
  const t = synth();
  const policies = t.findResources('AWS::IAM::Policy');
  const statements = Object.values(policies).flatMap((p: any) => p.Properties.PolicyDocument.Statement);
  const bedrock = statements.filter((s: any) => JSON.stringify(s.Action).includes('bedrock'));
  assert.equal(bedrock.length, 2);
  for (const s of bedrock) {
    assert.equal(s.Action, 'bedrock:InvokeModel');
    assert.ok(!JSON.stringify(s.Resource).includes('*'), 'no wildcard resources');
    assert.ok(JSON.stringify(s.Resource).includes('claude-haiku-4-5'));
  }
});

test('no NAT gateway, one task, logs kept a week', () => {
  const t = synth();
  t.resourceCountIs('AWS::EC2::NatGateway', 0);
  t.hasResourceProperties('AWS::ECS::Service', { DesiredCount: 1 });
  t.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 7 });
});

test('ALB: long idle timeout, CloudFront-only ingress, forwards only with the origin secret', () => {
  const t = synth();
  t.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
    LoadBalancerAttributes: Match.arrayWith([{ Key: 'idle_timeout.timeout_seconds', Value: '3600' }]),
  });
  t.hasResourceProperties('AWS::EC2::SecurityGroupIngress', { SourcePrefixListId: 'pl-3b927c52', FromPort: 80 });
  const groups = Object.values(t.findResources('AWS::EC2::SecurityGroup')) as any[];
  const ingress = [
    ...groups.flatMap(g => g.Properties.SecurityGroupIngress ?? []),
    ...(Object.values(t.findResources('AWS::EC2::SecurityGroupIngress')) as any[]).map(r => r.Properties),
  ];
  assert.ok(ingress.every(rule => !rule.CidrIp && !rule.CidrIpv6), 'no ingress is open to an IP range');
  t.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
    Conditions: [Match.objectLike({ Field: 'http-header', HttpHeaderConfig: { HttpHeaderName: 'X-Origin-Verify', Values: ['secret-value'] } })],
  });
  t.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
    DefaultActions: [Match.objectLike({ Type: 'fixed-response' })],
  });
});

test('CloudFront serves HTTPS and passes the WebSocket upgrade and query string through', () => {
  const t = synth();
  t.hasResourceProperties('AWS::CloudFront::Distribution', {
    DistributionConfig: Match.objectLike({
      DefaultCacheBehavior: Match.objectLike({
        ViewerProtocolPolicy: 'redirect-to-https',
        OriginRequestPolicyId: 'b689b0a8-53d0-40ab-baf2-68738e2966ac', // AllViewerExceptHostHeader
      }),
    }),
  });
});

test('access code and model call cap reach the container; MCP is off', () => {
  const [def] = Object.values(synth().findResources('AWS::ECS::TaskDefinition')) as any[];
  const env = Object.fromEntries(def.Properties.ContainerDefinitions[0].Environment.map((e: any) => [e.Name, e.Value]));
  assert.equal(env.ACCESS_CODE, 'ABC123');
  assert.equal(env.MODEL_CALLS_PER_DAY, '3000');
  assert.equal(env.MCP_ENABLED, 'false');
  assert.equal(env.MODEL_PROVIDER, 'bedrock');
});

test('Haiku spend budget of $10 with email alerts, only when an email is given', () => {
  synth().hasResourceProperties('AWS::Budgets::Budget', {
    Budget: Match.objectLike({ BudgetLimit: { Amount: 10, Unit: 'USD' }, CostFilters: { Service: ['Claude Haiku 4.5 (Amazon Bedrock Edition)'] } }),
  });
  synth({ alertEmail: undefined }).resourceCountIs('AWS::Budgets::Budget', 0);
});
