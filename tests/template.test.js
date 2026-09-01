const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// CloudFormation's short-form intrinsic tags (!Ref, !Sub, ...) aren't valid
// plain YAML, so js-yaml needs a schema that knows about them before it can
// parse template.yaml at all.
const cfnTags = [
  'Ref', 'Condition', 'Base64', 'GetAZs', 'ImportValue',
  'Sub', 'GetAtt', 'Join', 'Select', 'Split', 'FindInMap',
  'If', 'Not', 'Equals', 'And', 'Or', 'Cidr',
].map((name) => new yaml.Type(`!${name}`, {
  kind: name === 'GetAtt' || name === 'Sub' ? 'scalar' : 'sequence',
  multi: true,
  representName: () => name,
  construct: (data) => ({ [`Fn::${name}`]: data }),
}));

// Ref/Condition are scalar in practice; the rest can appear as scalar or sequence.
const scalarOrSeq = (name) => [
  new yaml.Type(`!${name}`, {
    kind: 'scalar',
    construct: (data) => ({ [name === 'Ref' || name === 'Condition' ? name : `Fn::${name}`]: data }),
  }),
  new yaml.Type(`!${name}`, {
    kind: 'sequence',
    construct: (data) => ({ [name === 'Ref' || name === 'Condition' ? name : `Fn::${name}`]: data }),
  }),
  new yaml.Type(`!${name}`, {
    kind: 'mapping',
    construct: (data) => ({ [name === 'Ref' || name === 'Condition' ? name : `Fn::${name}`]: data }),
  }),
];

const allTags = [
  'Ref', 'Condition', 'Base64', 'GetAZs', 'ImportValue', 'Sub', 'GetAtt',
  'Join', 'Select', 'Split', 'FindInMap', 'If', 'Not', 'Equals', 'And', 'Or', 'Cidr',
].flatMap(scalarOrSeq);

const CFN_SCHEMA = yaml.DEFAULT_SCHEMA.extend(allTags);

const raw = fs.readFileSync(path.join(__dirname, '..', 'template.yaml'), 'utf8');
const tpl = yaml.load(raw, { schema: CFN_SCHEMA });

const resources = tpl.Resources;
const byType = (type) => Object.entries(resources).filter(([, r]) => r.Type === type);

describe('template.yaml', () => {
  test('parses as valid YAML with CloudFormation intrinsics', () => {
    expect(tpl.Resources).toBeDefined();
    expect(tpl.Outputs).toBeDefined();
  });

  test('declares exactly 18 Lambda functions', () => {
    expect(byType('AWS::Serverless::Function')).toHaveLength(18);
  });

  test('every Lambda function uses an allowed Node runtime', () => {
    const fns = byType('AWS::Serverless::Function');
    const globalRuntime = tpl.Globals?.Function?.Runtime;
    for (const [, fn] of fns) {
      const runtime = fn.Properties.Runtime || globalRuntime;
      expect(['nodejs22.x', 'nodejs24.x']).toContain(runtime);
    }
  });

  test('declares exactly 18 log groups', () => {
    expect(byType('AWS::Logs::LogGroup')).toHaveLength(18);
  });

  test('declares exactly 8 IAM roles, each with the required permissions boundary and name prefix', () => {
    const roles = byType('AWS::IAM::Role');
    expect(roles).toHaveLength(8);
    for (const [, role] of roles) {
      expect(role.Properties.PermissionsBoundary).toEqual({ Ref: 'PermissionsBoundaryArn' });
      expect(role.Properties.RoleName['Fn::Sub']).toMatch(/^\$\{NamePrefix\}-/);
    }
  });

  test('every nameable resource is prefixed with the required NamePrefix', () => {
    const nameProps = ['FunctionName', 'RoleName', 'BucketName', 'QueueName', 'TopicName', 'Name', 'DBInstanceIdentifier'];
    for (const [logicalId, r] of Object.entries(resources)) {
      for (const prop of nameProps) {
        const v = r.Properties && r.Properties[prop];
        if (v && v['Fn::Sub']) {
          // SSM parameters live under the /NamePrefix/ path per the platform contract;
          // every other nameable resource uses the NamePrefix- prefix form.
          expect(v['Fn::Sub']).toMatch(/^(\$\{NamePrefix\}-|\/\$\{NamePrefix\}\/)/);
        }
      }
    }
  });

  test('RDS instance is db.t3.micro, publicly accessible, and not VPC-attached from Lambda', () => {
    const [, db] = byType('AWS::RDS::DBInstance')[0];
    expect(db.Properties.DBInstanceClass).toBe('db.t3.micro');
    expect(db.Properties.PubliclyAccessible).toBe(true);
    const fns = byType('AWS::Serverless::Function');
    for (const [, fn] of fns) {
      expect(fn.Properties.VpcConfig).toBeUndefined();
    }
  });

  test('ingest queue has a dead-letter queue with a bounded redrive policy', () => {
    const [, queue] = byType('AWS::SQS::Queue').find(([id]) => id === 'IngestQueue');
    expect(queue.Properties.RedrivePolicy.maxReceiveCount).toBe(3);
    expect(byType('AWS::SQS::Queue')).toHaveLength(2);
  });

  test('Cognito user pool has MFA off and no SMS/phone verification configured', () => {
    const [, pool] = byType('AWS::Cognito::UserPool')[0];
    expect(pool.Properties.MfaConfiguration).toBe('OFF');
    expect(pool.Properties.SmsConfiguration).toBeUndefined();
    expect(pool.Properties.AutoVerifiedAttributes).toEqual(['email']);
  });

  test('the gate-check route is API-key protected and bypasses the Cognito authorizer', () => {
    const [, releasesFn] = byType('AWS::Serverless::Function').find(([id]) => id === 'ApiReleasesFunction');
    const gateCheck = releasesFn.Properties.Events.GateCheck.Properties;
    expect(gateCheck.Auth.ApiKeyRequired).toBe(true);
    expect(gateCheck.Auth.Authorizer).toBe('NONE');
  });

  test('outputs include an app_url-equivalent CloudFront URL', () => {
    expect(tpl.Outputs.AppUrl).toBeDefined();
  });

  test('no CDK or ECS/Fargate/ALB resources are present', () => {
    const types = Object.values(resources).map((r) => r.Type);
    expect(types.some((t) => t.startsWith('AWS::ECS::'))).toBe(false);
    expect(types.some((t) => t.startsWith('AWS::ElasticLoadBalancingV2::'))).toBe(false);
    expect(types.some((t) => t === 'AWS::ECR::Repository')).toBe(false);
  });

  test('gate-eval, notify-slack, and every api-* Lambda\'s Handler maps to a real file exporting `handler`', () => {
    const logicalIds = [
      'GateEvalFunction', 'NotifySlackFunction',
      'ApiProjectsFunction', 'ApiPortfolioFunction', 'ApiFindingsFunction',
      'ApiReleasesFunction', 'ApiThresholdsFunction', 'ApiNotificationsFunction',
    ];
    for (const logicalId of logicalIds) {
      const fn = resources[logicalId];
      expect(fn).toBeDefined();
      const handlerProp = fn.Properties.Handler; // e.g. "handlers/api-projects.handler"
      const [modulePath, exportName] = handlerProp.split('.');
      expect(exportName).toBe('handler');
      const filePath = path.join(__dirname, '..', 'src', modulePath + '.js');
      expect(fs.existsSync(filePath)).toBe(true);
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const mod = require(filePath);
      expect(typeof mod.handler).toBe('function');
    }
  });
});
