const { mockClient } = require('aws-sdk-client-mock');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { s3RawKey, batchKey } = require('../../src/lib/ids');
const { today } = require('../../src/lib/runDate');

jest.mock('../../src/lib/secrets');
jest.mock('ssh2-sftp-client');
const { getSecretJson } = require('../../src/lib/secrets');
const SftpClient = require('ssh2-sftp-client');

const s3Mock = mockClient(S3Client);
const sqsMock = mockClient(SQSClient);

const ORIGINAL_ENV = { ...process.env };

const fixtures = {
  fortify: require('../fixtures/fortify.json'),
  trivy: require('../fixtures/trivy.json'),
  tricentis: require('../fixtures/tricentis.json'),
};

const handlerPaths = {
  fortify: '../../src/handlers/ingest-sftp-fortify',
  trivy: '../../src/handlers/ingest-sftp-trivy',
  tricentis: '../../src/handlers/ingest-sftp-tricentis',
};

describe('ingest SFTP handlers (fortify, trivy, tricentis)', () => {
  let connectMock;
  let getMock;
  let endMock;

  beforeEach(() => {
    s3Mock.reset();
    sqsMock.reset();
    process.env = {
      ...ORIGINAL_ENV,
      DATA_LAKE_BUCKET: 'test-datalake',
      INGEST_QUEUE_URL: 'https://sqs.test.example/queue',
      TOOL_SECRET_ARN: 'arn:aws:secretsmanager:ap-southeast-1:111111111111:secret:test',
    };

    connectMock = jest.fn().mockResolvedValue(undefined);
    getMock = jest.fn();
    endMock = jest.fn().mockResolvedValue(undefined);
    SftpClient.mockImplementation(() => ({ connect: connectMock, get: getMock, end: endMock }));
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.clearAllMocks();
  });

  test.each(['fortify', 'trivy', 'tricentis'])('%s: pulls one file over SFTP and publishes one S3 envelope + SQS message', async (tool) => {
    process.env.TOOL = tool;
    const project = { project_id: 'payments-api', name: 'Payments API', remotePath: `/exports/payments-api/${tool}.json` };
    getSecretJson.mockResolvedValue({
      host: 'sftp.example.com', username: 'svc', privateKey: 'PEM', projects: [project],
    });
    getMock.mockResolvedValue(Buffer.from(JSON.stringify(fixtures[tool].payload)));

    const { handler } = require(handlerPaths[tool]);
    await handler({});

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledWith(expect.objectContaining({ host: 'sftp.example.com', username: 'svc' }));
    expect(endMock).toHaveBeenCalledTimes(1);

    const puts = s3Mock.commandCalls(PutObjectCommand);
    expect(puts).toHaveLength(1);
    const expectedKey = s3RawKey(tool, 'payments-api', today());
    expect(puts[0].args[0].input.Key).toBe(expectedKey);

    const sends = sqsMock.commandCalls(SendMessageCommand);
    expect(sends).toHaveLength(1);
    const body = JSON.parse(sends[0].args[0].input.MessageBody);
    expect(body.batch_key).toBe(batchKey(tool, 'payments-api', today()));
    expect(body.s3_key).toBe(expectedKey);
  });

  test.each(['fortify', 'trivy', 'tricentis'])('%s: a placeholder (unconfigured) secret makes zero S3/SQS calls and never connects', async (tool) => {
    process.env.TOOL = tool;
    getSecretJson.mockResolvedValue({ host: 'REPLACE_ME', username: 'REPLACE_ME', privateKey: 'REPLACE_ME' });

    const { handler } = require(handlerPaths[tool]);
    const result = await handler({});

    expect(connectMock).not.toHaveBeenCalled();
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
    expect(result.skipped).toBe('not configured');
  });

  test.each(['fortify', 'trivy', 'tricentis'])('%s: end() is still called when get() rejects, and the error is not swallowed silently', async (tool) => {
    process.env.TOOL = tool;
    const project = { project_id: 'payments-api', name: 'Payments API', remotePath: `/exports/payments-api/${tool}.json` };
    getSecretJson.mockResolvedValue({
      host: 'sftp.example.com', username: 'svc', privateKey: 'PEM', projects: [project],
    });
    getMock.mockRejectedValue(new Error('sftp get failed'));

    const { handler } = require(handlerPaths[tool]);
    await expect(handler({})).rejects.toThrow();

    expect(endMock).toHaveBeenCalledTimes(1);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });
});
