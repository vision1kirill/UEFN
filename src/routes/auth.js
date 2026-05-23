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

    // Блокируем вход если email не подтверждён
    if (!user.email_verified) {
      // Отправляем новый OTP чтобы пользователь мог подтвердить
      const code = await createOtp(normalizedEmail, 'verify_email');
      sendOtpEmail(normalizedEmail, code, 'verify_email').catch(console.error);

      return res.status(403).json({
        error: 'Email не подтверждён. Мы выслали новый код на вашу почту.',
        code: 'EMAIL_NOT_VERIFIED',
        email: normalizedEmail,
      });
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
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT id, email, name, role, email_verified, created_at FROM users WHERE id = $1',
      [req.user.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Пользователь не найден.' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  PATCH /api/auth/me
//  Body: { name?, currentPassword?, newPassword? }
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/me', requireAuth, authLimiter, async (req, res, next) => {
  try {
    const { name, currentPassword, newPassword } = req.body;
    const updates = [];
    const vals    = [];

    // Update name
    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed) return res.status(400).json({ error: 'Имя не может быть пустым.' });
      if (trimmed.length > 30) return res.status(400).json({ error: 'Имя не должно превышать 30 символов.' });
      updates.push(`name = $${vals.length + 1}`);
      vals.push(trimmed);
    }

    // Update password
    if (newPassword !== undefined) {
      if (!currentPassword) return res.status(400).json({ error: 'Укажите текущий пароль.' });
      if (newPassword.length < 8) return res.status(400).json({ error: 'Новый пароль — минимум 8 символов.' });

      const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
      const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
      if (!match) return res.status(400).json({ error: 'Неверный текущий пароль.' });

      const hash = await bcrypt.hash(newPassword, 12);
      updates.push(`password_hash = $${vals.length + 1}`);
      vals.push(hash);
    }

    if (!updates.length) return res.status(400).json({ error: 'Нет данных для обновления.' });

    updates.push(`updated_at = NOW()`);
    vals.push(req.user.id);

    const { rows } = await query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${vals.length} RETURNING id, email, name, role`,
      vals,
    );

    res.json({ message: 'Профиль обновлён.', user: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/auth/change-email
//  Шаг 1: отправить OTP на СТАРЫЙ email
//  Body: { newEmail }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/change-email', requireAuth, authLimiter, async (req, res, next) => {
  try {
    const { newEmail } = req.body;
    if (!newEmail) return res.status(400).json({ error: 'Укажите новый email.' });

    const normalized = newEmail.trim().toLowerCase();

    // Не менять на тот же email
    if (normalized === req.user.email) {
      return res.status(400).json({ error: 'Это уже ваш текущий email.' });
    }

    // Проверить что новый email не занят
    const { rows: existing } = await query(
      'SELECT id FROM users WHERE email = $1',
      [normalized],
    );
    if (existing.length) {
      return res.status(409).json({ error: 'Этот email уже используется.' });
    }

    // Создать OTP для СТАРОГО email с новым email в purpose
    const purpose = `change_email:${normalized}`;
    const code = await createOtp(req.user.email, purpose);

    // Отправить код на старую почту
    await sendOtpEmail(req.user.email, code, 'verify_email');

    res.json({ message: 'Код подтверждения отправлен на вашу текущую почту.' });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/auth/confirm-email-change
//  Шаг 2: подтвердить OTP и сменить email
//  Body: { code }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/confirm-email-change', requireAuth, authLimiter, async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Введите код.' });

    // Найти актуальный OTP для старого email с purpose change_email:*
    const { rows } = await query(
      `SELECT id, purpose, expires_at, used
       FROM otp_codes
       WHERE email = $1 AND purpose LIKE 'change_email:%' AND code = $2
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.email, code],
    );

    if (!rows.length) {
      return res.status(400).json({ error: 'Неверный код подтверждения.' });
    }

    const otp = rows[0];
    if (otp.used) return res.status(400).json({ error: 'Код уже использован.' });
    if (new Date() > new Date(otp.expires_at)) {
      return res.status(400).json({ error: 'Срок действия кода истёк. Запросите новый.' });
    }

    // Извлечь новый email из purpose
    const newEmail = otp.purpose.replace('change_email:', '');

    // Проверить что новый email ещё не занят (могли занять пока ждали)
    const { rows: taken } = await query('SELECT id FROM users WHERE email = $1', [newEmail]);
    if (taken.length) {
      return res.status(409).json({ error: 'Этот email уже занят другим пользователем.' });
    }

    // Пометить OTP использованным
    await query('UPDATE otp_codes SET used = TRUE WHERE id = $1', [otp.id]);

    // Обновить email
    await query(
      'UPDATE users SET email = $1, updated_at = NOW() WHERE id = $2',
      [newEmail, req.user.id],
    );

    // Удалить все refresh-токены — пользователь должен войти заново
    await query('DELETE FROM refresh_tokens WHERE user_id = $1', [req.user.id]);

    res.json({ message: 'Email успешно изменён. Войдите с новым адресом.', newEmail });
  } catch (err) {
    next(err);
  }
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

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/auth/me
//  Returns current user profile + active subscription plan
// ─────────────────────────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.name, u.email, u.role,
              s.plan AS subscription_plan, s.status AS subscription_status, s.expires_at
       FROM users u
       LEFT JOIN subscriptions s
         ON s.user_id = u.id AND s.status = 'active'
       WHERE u.id = $1
       LIMIT 1`,
      [req.user.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Пользователь не найден.' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
