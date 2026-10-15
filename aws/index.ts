// ti-jeux on AWS, stopped by default. A Lambda receives Discord's launch requests:
// it wakes the instance when stopped, and forwards to it when running.
// The instance stops itself after 5 idle minutes (idle-stop.sh).
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

const config = new pulumi.Config();
const domain = config.require('domain');
const discordPublicKey = config.requireSecret('discordPublicKey');
const branch = config.get('branch') || 'feat/discord-activity';
const ami = aws.ssm.getParameterOutput({ name: '/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id' });
const assume = (service: string) => JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: service }, Action: 'sts:AssumeRole' }] });

// Session Manager shell from the console: no SSH key, no port 22.
const instanceRole = new aws.iam.Role('instance', {
  assumeRolePolicy: assume('ec2.amazonaws.com'),
  managedPolicyArns: ['arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore'],
});
const group = new aws.ec2.SecurityGroup('https', {
  description: 'ti-jeux HTTPS (80 for the certificate challenge)',
  ingress: [80, 443].map((port) => ({ protocol: 'tcp', fromPort: port, toPort: port, cidrBlocks: ['0.0.0.0/0'] })),
  egress: [{ protocol: '-1', fromPort: 0, toPort: 0, cidrBlocks: ['0.0.0.0/0'] }],
});
// No Elastic IP: it bills while stopped. duckdns.sh repoints the domain on every boot.
const instance = new aws.ec2.Instance('ti-jeux', {
  ami: ami.value,
  instanceType: config.get('instanceType') || 't4g.medium',
  iamInstanceProfile: new aws.iam.InstanceProfile('instance', { role: instanceRole.name }).name,
  vpcSecurityGroupIds: [group.id],
  instanceInitiatedShutdownBehavior: 'stop',
  // Holds the Docker image and the game logins, so it stays when the instance stops.
  rootBlockDevice: { volumeSize: 12, volumeType: 'gp3' },
  tags: { Name: 'ti-jeux' },
  userData: `#!/bin/bash
set -e
apt-get update && apt-get install -y docker.io docker-compose-v2 git
git clone -b ${branch} https://github.com/doumart/ti-jeux.git /opt/ti-jeux
cp /opt/ti-jeux/.env.example /opt/ti-jeux/.env
printf '%s\\n' '@reboot root /opt/ti-jeux/aws/duckdns.sh' '* * * * * root /opt/ti-jeux/aws/idle-stop.sh' > /etc/cron.d/ti-jeux
`,
});

const wakeRole = new aws.iam.Role('wake', {
  assumeRolePolicy: assume('lambda.amazonaws.com'),
  managedPolicyArns: ['arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
  inlinePolicies: [{
    name: 'wake',
    policy: instance.arn.apply((arn) => JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        // DescribeInstances has no resource-level permissions.
        { Effect: 'Allow', Action: 'ec2:DescribeInstances', Resource: '*' },
        { Effect: 'Allow', Action: 'ec2:StartInstances', Resource: arn },
      ],
    })),
  }],
});
const wake = new aws.lambda.Function('wake', {
  runtime: aws.lambda.Runtime.NodeJS22dX,
  architectures: ['arm64'],
  handler: 'index.handler',
  role: wakeRole.arn,
  code: new pulumi.asset.AssetArchive({ 'index.js': new pulumi.asset.FileAsset('wake.js') }),
  timeout: 5,
  memorySize: 256,
  environment: { variables: { INSTANCE_ID: instance.id, DOMAIN: domain, DISCORD_PUBLIC_KEY: discordPublicKey } },
});
const url = new aws.lambda.FunctionUrl('wake', { functionName: wake.name, authorizationType: 'NONE' });
// wake.js checks Discord's signature, so the URL itself is public.
new aws.lambda.Permission('wake-url', { function: wake.name, action: 'lambda:InvokeFunctionUrl', principal: '*', functionUrlAuthType: 'NONE' });
new aws.lambda.Permission('wake-invoke', { function: wake.name, action: 'lambda:InvokeFunction', principal: '*', invokedViaFunctionUrl: true });

// Paste into Discord Developer Portal → General Information → Interactions Endpoint URL.
export const interactionsEndpointUrl = url.functionUrl;
export const instanceId = instance.id;
