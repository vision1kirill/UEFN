const express   = require('express');
const rateLimit = require('express-rate-limit');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── Rate limit for public slug check ─────────────────────────────────────────
const slugCheckLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  message: { error: 'Слишком много запросов.' },
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/partners/check-slug?slug=xxx
//  Public — checks whether a partner slug is available
// ─────────────────────────────────────────────────────────────────────────────
router.get('/check-slug', slugCheckLimiter, async (req, res, next) => {
  try {
    const slug = (req.query.slug || '').toLowerCase().trim();

    if (!/^[a-z0-9-]{3,32}$/.test(slug)) {
      return res.status(400).json({
        available: false,
        error: 'Только строчные буквы, цифры и дефис. Минимум 3 символа.',
      });
    }

    const { rows } = await query(
      `SELECT 1 FROM partner_applications WHERE slug = $1
       UNION
       SELECT 1 FROM partners WHERE slug = $1
       LIMIT 1`,
      [slug],
    );

    res.json({ available: !rows.length, slug });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/partners/apply
//  Submit a partner application (partner.html form)
//  Authentication optional — if logged in, user_id is attached
// ─────────────────────────────────────────────────────────────────────────────
router.post('/apply', async (req, res, next) => {
  try {
    // Optional auth
    let userId = null;
    try {
      const { requireAuth: _ra } = require('../middleware/auth');
      // Manually check token without hard-failing
      const { verifyAccess } = require('../utils/jwt');
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : req.cookies?.access_token;
      if (token) {
        const payload = verifyAccess(token);
        userId = payload.sub;
      }
    } catch (_) { /* not logged in — that's OK */ }

    const {
      name, email, telegram, cooperation_type,
      audience, about, experience, social_links,
      traffic_source, motivation, comment, slug,
    } = req.body;

    // Basic validation
    if (!name || !email || !slug) {
      return res.status(400).json({ error: 'Имя, email и идентификатор обязательны.' });
    }

    const cleanSlug = slug.toLowerCase().trim();
    if (!/^[a-z0-9-]{3,32}$/.test(cleanSlug)) {
      return res.status(400).json({ error: 'Недопустимый идентификатор.' });
    }

    // Check slug uniqueness
    const { rows: existing } = await query(
      `SELECT 1 FROM partner_applications WHERE slug = $1
       UNION
       SELECT 1 FROM partners WHERE slug = $1
       LIMIT 1`,
      [cleanSlug],
    );
    if (existing.length) {
      return res.status(409).json({
        error: 'Этот идентификатор уже занят. Выберите другой.',
        field: 'slug',
      });
    }

    // Check no pending application from same email
    const { rows: dupApp } = await query(
      `SELECT id, status FROM partner_applications WHERE email = $1 ORDER BY created_at DESC LIMIT 1`,
      [email.trim().toLowerCase()],
    );
    if (dupApp.length && dupApp[0].status === 'pending') {
      return res.status(409).json({ error: 'Заявка с этим email уже находится на рассмотрении.' });
    }

    const { rows } = await query(
      `INSERT INTO partner_applications
         (user_id, name, email, telegram, cooperation_type,
          audience, about, experience, social_links,
          traffic_source, motivation, comment, slug)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        userId,
        name.trim(),
        email.trim().toLowerCase(),
        telegram?.trim() || null,
        cooperation_type || 'partner',
        audience?.trim() || null,
        about?.trim() || null,
        experience?.trim() || null,
        social_links?.trim() || null,
        traffic_source?.trim() || null,
        motivation?.trim() || null,
        comment?.trim() || null,
        cleanSlug,
      ],
    );

    res.status(201).json({
      message: 'Заявка принята! Мы рассмотрим её в течение 3 рабочих дней.',
      applicationId: rows[0].id,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/partners/me
//  Returns current user's partner profile
// ─────────────────────────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.id, p.slug, p.promo_code, p.balance, p.total_earned, p.created_at,
              u.name, u.email
       FROM partners p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id = $1`,
      [req.user.id],
    );

    if (!rows.length) {
      // Check if application is pending
      const { rows: app } = await query(
        `SELECT status FROM partner_applications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [req.user.id],
      );
      return res.status(404).json({
        error: 'Партнёрский профиль не найден.',
        applicationStatus: app[0]?.status || null,
      });
    }

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/partners/purchases
//  Returns orders attributed to this partner via referral
// ─────────────────────────────────────────────────────────────────────────────
router.get('/purchases', requireAuth, async (req, res, next) => {
  try {
    const { rows: partner } = await query(
      'SELECT id FROM partners WHERE user_id = $1',
      [req.user.id],
    );
    if (!partner.length) return res.status(404).json({ error: 'Партнёрский профиль не найден.' });

    const { rows } = await query(
      `SELECT o.id, o.product, o.amount, o.promo_code, o.status, o.created_at, o.paid_at,
              u.email AS buyer_email
       FROM orders o
       JOIN users u ON u.id = o.user_id
       WHERE o.referral_partner_id = $1
       ORDER BY o.created_at DESC`,
      [partner[0].id],
    );

    res.json({ purchases: rows });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/partners/referrals
//  Returns referrals (signups via partner link)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/referrals', requireAuth, async (req, res, next) => {
  try {
    const { rows: partner } = await query(
      'SELECT id FROM partners WHERE user_id = $1',
      [req.user.id],
    );
    if (!partner.length) return res.status(404).json({ error: 'Партнёрский профиль не найден.' });

    const { rows } = await query(
      `SELECT r.id, r.promo_code, r.created_at,
              u.email AS referred_email, u.name AS referred_name
       FROM referrals r
       JOIN users u ON u.id = r.referred_user_id
       WHERE r.partner_id = $1
       ORDER BY r.created_at DESC`,
      [partner[0].id],
    );

    res.json({ referrals: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/partners/payouts
//  Returns payout history for current partner
// ─────────────────────────────────────────────────────────────────────────────
router.get('/payouts', requireAuth, async (req, res, next) => {
  try {
    const { rows: partner } = await query(
      'SELECT id, balance FROM partners WHERE user_id = $1',
      [req.user.id],
    );
    if (!partner.length) return res.status(404).json({ error: 'Партнёрский профиль не найден.' });

    const { rows: payouts } = await query(
      `SELECT id, amount, method, commission_rate, commission_amount, amount_to_receive,
              status, created_at, processed_at
       FROM partner_payouts
       WHERE partner_id = $1
       ORDER BY created_at DESC`,
      [partner[0].id],
    );

    res.json({ payouts, balance: partner[0].balance });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/partners/payouts
//  Body: { amount, method, requisites }
// ─────────────────────────────────────────────────────────────────────────────
const COMMISSION_RATES = { card: 0.02, usdt: 0.01, sbp: 0 };
const MIN_PAYOUT = 500; // ₽

router.post('/payouts', requireAuth, async (req, res, next) => {
  try {
    const { amount, method, requisites } = req.body;

    const { rows: partner } = await query(
      'SELECT id, balance FROM partners WHERE user_id = $1',
      [req.user.id],
    );
    if (!partner.length) return res.status(404).json({ error: 'Партнёрский профиль не найден.' });

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount < MIN_PAYOUT) {
      return res.status(400).json({ error: `Минимальная сумма вывода ${MIN_PAYOUT} ₽.` });
    }

    if (!['card', 'usdt', 'sbp'].includes(method)) {
      return res.status(400).json({ error: 'Неверный способ вывода.' });
    }

    if (!requisites?.trim()) {
      return res.status(400).json({ error: 'Укажите реквизиты.' });
    }

    if (parsedAmount > parseFloat(partner[0].balance)) {
      return res.status(400).json({ error: 'Недостаточно средств на балансе.' });
    }

    const commissionRate   = COMMISSION_RATES[method];
    const commissionAmount = +(parsedAmount * commissionRate).toFixed(2);
    const amountToReceive  = +(parsedAmount - commissionAmount).toFixed(2);

    const client = await require('../db').getClient();
    try {
      await client.query('BEGIN');

      // Deduct balance
      await client.query(
        'UPDATE partners SET balance = balance - $1 WHERE id = $2',
        [parsedAmount, partner[0].id],
      );

      // Create payout record
      const { rows } = await client.query(
        `INSERT INTO partner_payouts
           (partner_id, amount, method, requisites,
            commission_rate, commission_amount, amount_to_receive)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id`,
        [partner[0].id, parsedAmount, method, requisites.trim(),
         commissionRate, commissionAmount, amountToReceive],
      );

      await client.query('COMMIT');
      res.status(201).json({
        message: 'Заявка на вывод создана.',
        payoutId: rows[0].id,
        amountToReceive,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
