const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const client = new SecretsManagerClient({});
const cache = new Map();

async function getSecretJson(arn) {
  if (cache.has(arn)) return cache.get(arn);
  const result = await client.send(new GetSecretValueCommand({ SecretId: arn }));
  const parsed = JSON.parse(result.SecretString);
  cache.set(arn, parsed);
  return parsed;
}

module.exports = { getSecretJson };
