/**
 * Commander on AWS: one Fargate task (all rooms live in its memory) behind an ALB, with CloudFront
 * in front for HTTPS/WSS on its default *.cloudfront.net certificate, so no domain or ACM cert is needed.
 * Structure cribbed from TRACI's langfuse-ecs stack (ALB + Fargate service, circuit-breaker rollback,
 * one-week log retention), cut down to a single stateless service.
 *
 * Traffic: browser --HTTPS/WSS--> CloudFront --HTTP + secret header--> ALB --> task :8080.
 * The ALB only accepts CloudFront's origin-facing IP ranges and forwards only requests carrying the
 * secret header, so nobody can skip CloudFront (or the access code check behind it).
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';

export const HAIKU_PROFILE_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
const HAIKU_MODEL_ID = 'anthropic.claude-haiku-4-5-20251001-v1:0';
// Regions the us. cross-region inference profile can route a Haiku 4.5 call to
const HAIKU_PROFILE_REGIONS = ['us-east-1', 'us-east-2', 'us-west-2'];
// AWS-managed prefix list of CloudFront's origin-facing IPs (com.amazonaws.global.cloudfront.origin-facing), us-east-1
const CLOUDFRONT_ORIGIN_PREFIX_LIST = 'pl-3b927c52';
const ORIGIN_HEADER = 'X-Origin-Verify';
const CONTAINER_PORT = 8080;

export interface CommanderStackProps extends cdk.StackProps {
  /** Shared by CloudFront and the ALB so only CloudFront can reach the ALB. */
  originSecret: string;
  /** When set, the game socket only opens with ?code=<accessCode>. */
  accessCode?: string;
  /** Alarm emails go here (each subscription needs one confirmation click). */
  alertEmail?: string;
  /** Server-side hard ceiling on model calls per UTC day. */
  modelCallsPerDay?: number;
  /** Tests pass a registry image so synth needs no Docker build context. */
  image?: ecs.ContainerImage;
}

export class CommanderStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CommanderStackProps) {
    super(scope, id, props);

    const modelCallsPerDay = props.modelCallsPerDay ?? 3000;

    // Public subnets only and no NAT gateway: the task gets a public IP to reach ECR and Bedrock,
    // but its security group only admits the ALB.
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }],
      restrictDefaultSecurityGroup: false,
    });

    const cluster = new ecs.Cluster(this, 'Cluster', { vpc, containerInsightsV2: ecs.ContainerInsights.DISABLED });

    const logGroup = new logs.LogGroup(this, 'Logs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const taskDef = new ecs.FargateTaskDefinition(this, 'Task', {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    });

    // Task role: invoke Haiku 4.5 through the us. inference profile, nothing else
    const profileArn = `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${HAIKU_PROFILE_ID}`;
    taskDef.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [profileArn],
    }));
    taskDef.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: HAIKU_PROFILE_REGIONS.map(r => `arn:aws:bedrock:${r}::foundation-model/${HAIKU_MODEL_ID}`),
      conditions: { StringEquals: { 'bedrock:InferenceProfileArn': profileArn } },
    }));

    const image = props.image ?? ecs.ContainerImage.fromAsset(`${__dirname}/../..`, { platform: Platform.LINUX_ARM64 });
    const container = taskDef.addContainer('app', {
      image,
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'commander' }),
      environment: {
        PORT: String(CONTAINER_PORT),
        MODEL_PROVIDER: 'bedrock',
        BEDROCK_MODEL_ID: HAIKU_PROFILE_ID,
        AWS_REGION: this.region,
        MODEL_CALLS_PER_DAY: String(modelCallsPerDay),
        MAX_ROOMS: '40',
        MCP_ENABLED: 'false',
        ...(props.accessCode ? { ACCESS_CODE: props.accessCode } : {}),
      },
    });
    container.addPortMappings({ containerPort: CONTAINER_PORT });

    const albSg = new ec2.SecurityGroup(this, 'AlbSg', { vpc, allowAllOutbound: false, description: 'Commander ALB: CloudFront only' });
    albSg.addIngressRule(ec2.Peer.prefixList(CLOUDFRONT_ORIGIN_PREFIX_LIST), ec2.Port.tcp(80), 'CloudFront origin-facing');

    // Idle timeout raised so quiet lobby sockets are not cut (the server also pings every 20 s)
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      idleTimeout: cdk.Duration.seconds(3600),
    });

    const taskSg = new ec2.SecurityGroup(this, 'TaskSg', { vpc, allowAllOutbound: true, description: 'Commander task: ALB only' });

    // One task holds every room in memory, so exactly one runs; sticky sessions are unnecessary.
    // Note a redeploy restarts the task and drops live games.
    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      assignPublicIp: true,
      securityGroups: [taskSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      circuitBreaker: { rollback: true },
    });

    const listener = alb.addListener('Http', {
      port: 80,
      open: false,
      defaultAction: elbv2.ListenerAction.fixedResponse(403, { contentType: 'text/plain', messageBody: 'Forbidden' }),
    });
    const targetGroup = listener.addTargets('Game', {
      priority: 1,
      conditions: [elbv2.ListenerCondition.httpHeader(ORIGIN_HEADER, [props.originSecret])],
      port: CONTAINER_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      deregistrationDelay: cdk.Duration.seconds(15),
      healthCheck: { path: '/healthz', interval: cdk.Duration.seconds(15), healthyThresholdCount: 2 },
    });

    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      comment: 'Commander (Remote to TR breakout, 10/15/2026)',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: new origins.HttpOrigin(alb.loadBalancerDnsName, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          customHeaders: { [ORIGIN_HEADER]: props.originSecret },
          readTimeout: cdk.Duration.seconds(60),
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        // Passes the WebSocket upgrade headers and the ?code= query string through
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
    });

    // Alerts: a model-call rate alarm and a health alarm. Both count only this stack's traffic. There is no
    // AWS Budget: the Bedrock billing line and the AWS/Bedrock token metrics are account-wide (every Haiku
    // call in the sandbox), and this linked account can't activate cost allocation tags to narrow them.
    // The server's MODEL_CALLS_PER_DAY cap is the hard spend limit; this alarm is the early warning.
    const alerts = new sns.Topic(this, 'Alerts', { displayName: 'Commander alerts' });
    if (props.alertEmail) alerts.addSubscription(new subs.EmailSubscription(props.alertEmail));

    // PromptTranslator logs one "commander_model_call" line per answered model call
    const modelCalls = new logs.MetricFilter(this, 'ModelCallsFilter', {
      logGroup,
      filterPattern: logs.FilterPattern.literal('"commander_model_call"'),
      metricNamespace: 'Commander',
      metricName: 'ModelCalls',
      metricValue: '1',
      defaultValue: 0,
    }).metric({ statistic: 'Sum', period: cdk.Duration.hours(1) });
    new cloudwatch.Alarm(this, 'ModelSpendAlarm', {
      alarmDescription: 'Commander made over 1000 model calls in an hour (about $2/hour of Haiku 4.5 at roughly $0.002 a call)',
      metric: modelCalls,
      threshold: 1000,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new cwActions.SnsAction(alerts));

    new cloudwatch.Alarm(this, 'UnhealthyAlarm', {
      alarmDescription: 'The Commander task is failing its health check',
      metric: targetGroup.metrics.healthyHostCount({ period: cdk.Duration.minutes(1), statistic: 'Minimum' }),
      threshold: 1,
      evaluationPeriods: 5,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    }).addAlarmAction(new cwActions.SnsAction(alerts));

    const base = `https://${distribution.distributionDomainName}`;
    const code = props.accessCode ? `?code=${props.accessCode}` : '';
    new cdk.CfnOutput(this, 'PlayUrl', { value: `${base}/${code}`, description: 'Link to hand out (carries the access code)' });
    new cdk.CfnOutput(this, 'WsUrl', { value: `wss://${distribution.distributionDomainName}/ws${code}`, description: 'For prompt-smoke.mjs' });
  }
}
