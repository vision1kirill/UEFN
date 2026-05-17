const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

/**
 * Run a parameterised query.
 * @param {string} text   SQL string with $1, $2 … placeholders
 * @param {any[]}  params Array of bind values
 */
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV !== 'production') {
    console.log('query', { text, duration, rows: res.rowCount });
  }
  return res;
}

/**
 * Grab a client from the pool for manual transaction control.
 * Remember to client.release() in a finally block.
 */
async function getClient() {
  return pool.connect();
}

module.exports = { query, getClient, pool };
