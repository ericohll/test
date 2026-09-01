const mysql = require('mysql2/promise');
const { getSecretJson } = require('./secrets');

let pool;

async function getPool() {
  if (pool) return pool;
  const creds = await getSecretJson(process.env.DB_SECRET_ARN);
  pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME,
    user: creds.username,
    password: creds.password,
    ssl: process.env.DB_SSL === 'require' ? { rejectUnauthorized: false } : undefined,
    waitForConnections: true,
    connectionLimit: 2,
    decimalNumbers: true,
  });
  return pool;
}

async function withConnection(fn) {
  const p = await getPool();
  const conn = await p.getConnection();
  try {
    return await fn(conn);
  } finally {
    conn.release();
  }
}

async function withTransaction(fn) {
  return withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    }
  });
}

module.exports = { getPool, withConnection, withTransaction };
