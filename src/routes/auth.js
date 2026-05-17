const express    = require('express');
const bcrypt     = require('bcryptjs');
const rateLimit  = require('express-rate-limit');

const { query }                          = require('../db');
const { signAccess, generateRefreshToken, hashToken, REFRESH_MAX_AGE } = require('../utils/jwt');
const { createOtp, verifyOtp }           = require('../utils/otp');
const { sendOtpEmail, sendWelcomeEmail } = require('../utils/email');
const { requireAuth }                    = require('../middleware/auth');

const router = express.Router();

// ── Strict rate limit for auth endpoints ──────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  message: { error: 'Слишком много попыток. Попробуйте через 15 минут.' },
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function setRefreshCookie(res, token) {
  res.cookie('refresh_token', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   REFRESH_MAX_AGE,
    path:     '/api/auth',
  });
}

function clearRefreshCookie(res) {
  res.clearCookie('refresh_token', { path: '/api/auth' });
}

async function issueTokens(res, user) {
  const accessToken  = signAccess({ sub: user.id, role: user.role });
  const refreshToken = generateRefreshToken();
  const tokenHash    = hashToken(refreshToken);
  const expiresAt    = new Date(Date.now() + REFRESH_MAX_AGE);

  // Persist refresh token (rotate: keep last 5 per user)
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, tokenHash, expiresAt],
  );

  // Prune old tokens (keep newest 5)
  await query(
    `DELETE FROM refresh_tokens
     WHERE user_id = $1
       AND id NOT IN (
         SELECT id FROM refresh_tokens WHERE user_id = $1
         ORDER BY created_at DESC LIMIT 5
       )`,
    [user.id],
  );

  setRefreshCookie(res, refreshToken);

  return { accessToken, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
}

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/auth/register
//  Body: { email, password, name }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email и пароль обязательны.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Пароль должен быть не менее 8 символов.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check duplicate
    const existing = await query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Пользователь с таким email уже существует.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const { rows } = await query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, role`,
      [normalizedEmail, passwordHash, name?.trim() || null],
    );
    const user = rows[0];

    // Send OTP for email verification
    const code = await createOtp(normalizedEmail, 'verify_email');
    await sendOtpEmail(normalizedEmail, code, 'verify_email');

    // Issue tokens straight away (user can use the app before verifying email)
    const result = await issueTokens(res, user);
    res.status(201).json({ ...result, message: 'Аккаунт создан. Проверьте email для подтверждения.' });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/auth/send-otp
//  Body: { email, purpose }   purpose: verify_email | login | reset_password
// ─────────────────────────────────────────────────────────────────────────────
router.post('/send-otp', authLimiter, async (req, res, next) => {
  try {
    const { email, purpose = 'verify_email' } = req.body;
    if (!email) return res.status(400).json({ error: 'Email обязателен.' });

    const normalizedEmail = email.trim().toLowerCase();
    const code = await createOtp(normalizedEmail, purpose);

    // Fire-and-forget — don't leak errors about whether email exists
    sendOtpEmail(normalizedEmail, code, purpose).catch(err => {
      console.error('Email send error:', err.message);
    });

    res.json({ message: 'Код отправлен на email.' });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/auth/verify-otp
//  Body: { email, code, purpose }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/verify-otp', authLimiter, async (req, res, next) => {
  try {
    const { email, code, purpose = 'verify_email' } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'Email и код обязательны.' });

    const normalizedEmail = email.trim().toLowerCase();
    await verifyOtp(normalizedEmail, purpose, code);

    if (purpose === 'verify_email') {
      await query(
        'UPDATE users SET email_verified = TRUE, updated_at = NOW() WHERE email = $1',
        [normalizedEmail],
      );

      // Send welcome email on first verification
      const { rows } = await query('SELECT name FROM users WHERE email = $1', [normalizedEmail]);
      if (rows.length) {
        sendWelcomeEmail(normalizedEmail, rows[0].name).catch(console.error);
      }
    }

    res.json({ message: 'Email подтверждён.' });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/auth/login
//  Body: { email, password }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email и пароль обязательны.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const { rows } = await query(
      'SELECT id, email, name, role, password_hash, email_verified FROM users WHERE email = $1',
      [normalizedEmail],
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'Неверный email или пароль.' });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Неверный email или пароль.' });
    }

    const result = await issueTokens(res, user);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/auth/refresh
//  Cookie: refresh_token
// ─────────────────────────────────────────────────────────────────────────────
router.post('/refresh', async (req, res, next) => {
  try {
    const rawToken = req.cookies?.refresh_token;
    if (!rawToken) return res.status(401).json({ error: 'Refresh token отсутствует.' });

    const tokenHash = hashToken(rawToken);

    const { rows } = await query(
      `SELECT rt.user_id, rt.expires_at, u.id, u.email, u.name, u.role
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1`,
      [tokenHash],
    );

    if (!rows.length) return res.status(401).json({ error: 'Недействительный refresh token.' });

    const record = rows[0];
    if (new Date() > new Date(record.expires_at)) {
      return res.status(401).json({ error: 'Refresh token истёк. Войдите снова.' });
    }

    // Rotate: delete old, issue new
    await query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);

    const result = await issueTokens(res, record);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/auth/logout
// ─────────────────────────────────────────────────────────────────────────────
router.post('/logout', async (req, res, next) => {
  try {
    const rawToken = req.cookies?.refresh_token;
    if (rawToken) {
      const tokenHash = hashToken(rawToken);
      await query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
    }
    clearRefreshCookie(res);
    res.json({ message: 'Вы вышли из системы.' });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/auth/me
// ─────────────────────────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  const { id, email, name, role, email_verified } = req.user;
  res.json({ id, email, name, role, email_verified });
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/auth/reset-password
//  Body: { email, code, newPassword }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/reset-password', authLimiter, async (req, res, next) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'Все поля обязательны.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Пароль должен быть не менее 8 символов.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    await verifyOtp(normalizedEmail, 'reset_password', code);

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE email = $2',
      [passwordHash, normalizedEmail],
    );

    // Revoke all refresh tokens (force re-login everywhere)
    const { rows } = await query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (rows.length) {
      await query('DELETE FROM refresh_tokens WHERE user_id = $1', [rows[0].id]);
    }

    clearRefreshCookie(res);
    res.json({ message: 'Пароль успешно изменён. Войдите с новым паролем.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
