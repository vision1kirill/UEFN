const { verifyAccess } = require('../utils/jwt');
const { query }        = require('../db');

/**
 * requireAuth — attach req.user or return 401.
 * Reads the access token from:
 *   1. Authorization: Bearer <token>  header  (preferred)
 *   2. Cookie: access_token=<token>
 */
async function requireAuth(req, res, next) {
  try {
    let token = null;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else if (req.cookies && req.cookies.access_token) {
      token = req.cookies.access_token;
    }

    if (!token) {
      return res.status(401).json({ error: 'Необходима авторизация.' });
    }

    const payload = verifyAccess(token);

    // Fetch fresh user record (catches deleted / role-changed users)
    const { rows } = await query(
      'SELECT id, email, name, role, email_verified FROM users WHERE id = $1',
      [payload.sub],
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'Пользователь не найден.' });
    }

    req.user = rows[0];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Токен истёк. Обновите сессию.', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Недействительный токен.' });
  }
}

/**
 * requireRole — middleware factory.
 * Usage: router.get('/admin', requireAuth, requireRole('admin'), handler)
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Необходима авторизация.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Недостаточно прав.' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
