const { query } = require('../db');

const OTP_EXPIRES_MINUTES = parseInt(process.env.OTP_EXPIRES_MINUTES || '10', 10);

/** Generate a 6-digit numeric OTP code */
function generateCode() {
  return String(Math.floor(100_000 + Math.random() * 900_000));
}

/**
 * Create (or replace) an OTP for a given email + purpose.
 * Old unused codes for the same email/purpose are deleted first.
 */
async function createOtp(email, purpose) {
  // Delete previous codes for this email+purpose
  await query(
    'DELETE FROM otp_codes WHERE email = $1 AND purpose = $2',
    [email, purpose],
  );

  const code      = generateCode();
  const expiresAt = new Date(Date.now() + OTP_EXPIRES_MINUTES * 60_000);

  await query(
    `INSERT INTO otp_codes (email, code, purpose, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [email, code, purpose, expiresAt],
  );

  return code;
}

/**
 * Verify an OTP code. Returns true on success, throws on failure.
 * Marks the code as used on success.
 */
async function verifyOtp(email, purpose, code) {
  const { rows } = await query(
    `SELECT id, expires_at, used
     FROM otp_codes
     WHERE email = $1 AND purpose = $2 AND code = $3
     ORDER BY created_at DESC
     LIMIT 1`,
    [email, purpose, code],
  );

  if (!rows.length) {
    const err = new Error('Неверный код подтверждения.');
    err.status = 400;
    throw err;
  }

  const otp = rows[0];

  if (otp.used) {
    const err = new Error('Код уже был использован.');
    err.status = 400;
    throw err;
  }

  if (new Date() > new Date(otp.expires_at)) {
    const err = new Error('Срок действия кода истёк. Запросите новый.');
    err.status = 400;
    throw err;
  }

  // Mark as used
  await query('UPDATE otp_codes SET used = TRUE WHERE id = $1', [otp.id]);

  return true;
}

module.exports = { createOtp, verifyOtp };
