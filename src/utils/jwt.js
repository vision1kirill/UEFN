const jwt    = require('jsonwebtoken');
const crypto = require('crypto');

const ACCESS_SECRET  = process.env.JWT_SECRET;
const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES  || '15m';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '30d';

// ── Access token ──────────────────────────────────────────────────────────────
function signAccess(payload) {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES });
}

function verifyAccess(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

// ── Refresh token ─────────────────────────────────────────────────────────────
function generateRefreshToken() {
  return crypto.randomBytes(64).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Convert "30d" → ms for cookie maxAge */
function expiresInMs(str) {
  const units = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const match = /^(\d+)([smhd])$/.exec(str);
  if (!match) return 30 * 86_400_000;
  return parseInt(match[1], 10) * (units[match[2]] || 86_400_000);
}

const REFRESH_MAX_AGE = expiresInMs(REFRESH_EXPIRES);

module.exports = {
  signAccess,
  verifyAccess,
  generateRefreshToken,
  hashToken,
  REFRESH_MAX_AGE,
};
