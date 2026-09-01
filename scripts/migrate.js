#!/usr/bin/env node
// Applies db/migrations/*.sql, in filename order, against the RDS instance a
// deploy just created/updated. Not a Lambda -- invoked directly by deploy.sh
// after the CloudFormation stack reaches a steady state, using the stack's
// DbEndpoint/DbSecretArn outputs. Tracks applied versions in the
// schema_migrations table so re-running deploy.sh is a no-op here.
//
// Required env vars: DB_HOST, DB_SECRET_ARN. Optional: DB_PORT (3306),
// DB_NAME (quality_dashboard), AWS_REGION.

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

async function getDbCredentials(secretArn) {
  const client = new SecretsManagerClient({});
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  return JSON.parse(result.SecretString);
}

async function getAppliedVersions(conn) {
  try {
    const [rows] = await conn.query('SELECT version FROM schema_migrations');
    return new Set(rows.map((r) => r.version));
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') return new Set();
    throw err;
  }
}

async function main() {
  const dbHost = process.env.DB_HOST;
  const dbSecretArn = process.env.DB_SECRET_ARN;
  if (!dbHost || !dbSecretArn) {
    throw new Error('migrate.js requires DB_HOST and DB_SECRET_ARN in the environment');
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (!files.length) {
    console.log('migrate: no migration files found, nothing to do');
    return;
  }

  const creds = await getDbCredentials(dbSecretArn);
  const conn = await mysql.createConnection({
    host: dbHost,
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || 'quality_dashboard',
    user: creds.username,
    password: creds.password,
    ssl: process.env.DB_SSL === 'require' ? { rejectUnauthorized: false } : undefined,
    multipleStatements: true,
  });

  try {
    const applied = await getAppliedVersions(conn);
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (applied.has(version)) {
        console.log(`migrate: ${version} already applied, skipping`);
        continue;
      }
      console.log(`migrate: applying ${version}`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await conn.query(sql);
      console.log(`migrate: applied ${version}`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('migrate: failed:', err.message);
  process.exit(1);
});
