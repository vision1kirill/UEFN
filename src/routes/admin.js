const express = require('express');
const { query } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// All admin routes require auth + admin role
router.use(requireAuth, requireRole('admin'));

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/admin/applications/:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/applications/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT pa.*, u.email AS user_email, u.name AS user_name
       FROM partner_applications pa
       LEFT JOIN users u ON u.id = pa.user_id
       WHERE pa.id = $1`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Заявка не найдена.' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/admin/users
//  Query: ?role=user|partner|admin&page=1&limit=20&search=email
// ─────────────────────────────────────────────────────────────────────────────
router.get('/users', async (req, res, next) => {
  try {
    const { role, page = 1, limit = 20, search } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const conditions = [];
    const params = [];

    if (role) {
      params.push(role);
      conditions.push(`role = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(email ILIKE $${params.length} OR name ILIKE $${params.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(parseInt(limit, 10));
    params.push(offset);

    const { rows } = await query(
      `SELECT id, email, name, role, email_verified, created_at
       FROM users ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    res.json({ users: rows });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/admin/chart
//  Sales grouped by day for the last 30 days (for dashboard chart)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/chart', async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const days = parseInt(req.query.days, 10) || 14;

    let dateFilter, params;
    if (from && to) {
      dateFilter = `paid_at >= $1::date AND paid_at < ($2::date + interval '1 day')`;
      params = [from, to];
    } else {
      dateFilter = `paid_at >= NOW() - ($1 || ' days')::interval`;
      params = [days];
    }

    const { product } = req.query;
    let productFilter;
    if (product) {
      params.push(product);
      productFilter = `AND product = $${params.length}`;
    } else {
      productFilter = `AND product != 'Partnership'`;
    }

    const { rows } = await query(
      `SELECT DATE(paid_at) AS day, product,
              COUNT(*)::int AS count, SUM(amount)::numeric AS revenue
       FROM orders
       WHERE status = 'paid' ${productFilter} AND ${dateFilter}
       GROUP BY DATE(paid_at), product
       ORDER BY day ASC`,
      params,
    );
    res.json({ chart: rows });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/admin/stats
//  Dashboard summary
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stats', async (req, res, next) => {
  try {
    const [users, orders, partners, pendingApps, payouts] = await Promise.all([
      query(`SELECT COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS last30d
             FROM users`),
      query(`SELECT COUNT(*) AS total,
                    COALESCE(SUM(amount) FILTER (WHERE status='paid'), 0) AS revenue,
                    COUNT(*) FILTER (WHERE status='paid') AS paid_count
             FROM orders`),
      query(`SELECT COUNT(*) AS total FROM partners`),
      query(`SELECT COUNT(*) AS total FROM partner_applications WHERE status='pending'`),
      query(`SELECT COALESCE(SUM(amount) FILTER (WHERE status='pending'), 0) AS pending_amount
             FROM partner_payouts`),
    ]);

    res.json({
      users: {
        total:  parseInt(users.rows[0].total, 10),
        last30d: parseInt(users.rows[0].last30d, 10),
      },
      orders: {
        total:     parseInt(orders.rows[0].total, 10),
        revenue:   parseFloat(orders.rows[0].revenue),
        paidCount: parseInt(orders.rows[0].paid_count, 10),
      },
      partners: {
        total: parseInt(partners.rows[0].total, 10),
      },
      pendingApplications: parseInt(pendingApps.rows[0].total, 10),
      pendingPayouts: parseFloat(payouts.rows[0].pending_amount),
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/admin/sales
//  All orders with buyer + partner info
// ─────────────────────────────────────────────────────────────────────────────
router.get('/sales', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, from, to, search, product } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const params = [];
    const conds  = [];

    if (status)  { params.push(status);        conds.push(`o.status = $${params.length}`); }
    if (product) { params.push(product);        conds.push(`o.product = $${params.length}`); }
    if (from)    { params.push(from);           conds.push(`o.created_at >= $${params.length}::date`); }
    if (to)      { params.push(to);             conds.push(`o.created_at < ($${params.length}::date + interval '1 day')`); }
    if (search)  { params.push(`%${search}%`);  conds.push(`(u.email ILIKE $${params.length} OR u.name ILIKE $${params.length})`); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const { rows: countRows } = await query(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(o.amount) FILTER (WHERE o.status='paid'), 0) AS revenue
       FROM orders o JOIN users u ON u.id = o.user_id ${where}`,
      params,
    );

    params.push(parseInt(limit, 10));
    params.push(offset);

    const { rows } = await query(
      `SELECT o.id, o.product, o.amount, o.promo_code, o.status, o.created_at, o.paid_at,
              u.email AS buyer_email, u.name AS buyer_name,
              p.slug AS partner_slug
       FROM orders o
       JOIN users u ON u.id = o.user_id
       LEFT JOIN partners p ON p.id = o.referral_partner_id
       ${where}
       ORDER BY o.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    res.json({
      sales:   rows,
      total:   parseInt(countRows[0].total, 10),
      revenue: parseFloat(countRows[0].revenue),
      page:    parseInt(page, 10),
      limit:   parseInt(limit, 10),
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/admin/payouts
//  All partner payout requests (for admin processing)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/payouts', async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const params = [];
    let where = '';

    if (status) {
      params.push(status);
      where = `WHERE pp.status = $${params.length}`;
    }

    params.push(parseInt(limit, 10));
    params.push(offset);

    const { rows } = await query(
      `SELECT pp.*, p.slug AS partner_slug, u.email AS partner_email
       FROM partner_payouts pp
       JOIN partners p ON p.id = pp.partner_id
       JOIN users u ON u.id = p.user_id
       ${where}
       ORDER BY pp.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    res.json({ payouts: rows });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  PATCH /api/admin/payouts/:id
//  Body: { status: 'processing' | 'paid' | 'rejected', rejectReason? }
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/payouts/:id', async (req, res, next) => {
  try {
    const { status, rejectReason } = req.body;
    const allowed = ['processing', 'paid', 'rejected'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `status: ${allowed.join(' | ')}` });
    }

    const { rows } = await query(
      `UPDATE partner_payouts
       SET status = $1,
           reject_reason = $2,
           processed_at = CASE WHEN $1 IN ('paid','rejected') THEN NOW() ELSE processed_at END
       WHERE id = $3
       RETURNING id`,
      [status, rejectReason || null, req.params.id],
    );

    if (!rows.length) return res.status(404).json({ error: 'Выплата не найдена.' });

    // If rejected, refund balance to partner
    if (status === 'rejected') {
      await query(
        `UPDATE partners p
         SET balance = balance + pp.amount
         FROM partner_payouts pp
         WHERE pp.id = $1 AND p.id = pp.partner_id`,
        [req.params.id],
      );
    }

    res.json({ message: 'Статус выплаты обновлён.' });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/admin/users/:id/grant-access
//  Manually grant course access (create a paid order)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/users/:id/grant-access', async (req, res, next) => {
  try {
    const { product = 'Essential' } = req.body;

    // Check if already has access
    const { rows: existing } = await query(
      `SELECT id FROM orders WHERE user_id = $1 AND status = 'paid' LIMIT 1`,
      [req.params.id],
    );
    if (existing.length) {
      return res.status(400).json({ error: 'У пользователя уже есть доступ к курсу.' });
    }

    await query(
      `INSERT INTO orders (user_id, product, amount, status, paid_at)
       VALUES ($1, $2, 0, 'paid', NOW())`,
      [req.params.id, product],
    );

    res.json({ message: 'Доступ выдан.' });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  DELETE /api/admin/users/:id/revoke-access
//  Revoke course access (delete paid orders)
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/users/:id/revoke-access', async (req, res, next) => {
  try {
    await query(
      `DELETE FROM orders WHERE user_id = $1 AND status = 'paid'`,
      [req.params.id],
    );
    res.json({ message: 'Доступ отозван.' });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  DELETE /api/admin/users/:id
//  Delete user completely
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/users/:id', async (req, res, next) => {
  try {
    if (String(req.params.id) === String(req.user.id)) {
      return res.status(400).json({ error: 'Нельзя удалить самого себя.' });
    }
    const { rows } = await query(
      'DELETE FROM users WHERE id = $1 RETURNING id',
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Пользователь не найден.' });
    res.json({ message: 'Пользователь удалён.' });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  PATCH /api/admin/users/:id/role
//  Body: { role: 'user' | 'partner' | 'admin' }
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/users/:id/role', async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!['user', 'partner', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'role: user | partner | admin' });
    }
    const { rows } = await query(
      'UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING id',
      [role, req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Пользователь не найден.' });
    res.json({ message: 'Роль обновлена.' });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/admin/subscriptions/stats
//  Aggregate stats for course subscriptions (excludes Partnership)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/subscriptions/stats', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT
         COUNT(*)                                                               AS total,
         COUNT(*) FILTER (WHERE status = 'paid')                               AS active,
         COUNT(*) FILTER (WHERE status = 'refunded')                           AS completed,
         COUNT(*) FILTER (WHERE status = 'pending')                            AS on_pause,
         COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)               AS revenue,
         COUNT(*) FILTER (WHERE status = 'paid'
                          AND created_at > NOW() - INTERVAL '30 days')         AS last30d
       FROM orders
       WHERE product != 'Partnership'`,
    );
    res.json({
      total:     parseInt(rows[0].total, 10),
      active:    parseInt(rows[0].active, 10),
      completed: parseInt(rows[0].completed, 10),
      onPause:   parseInt(rows[0].on_pause, 10),
      revenue:   parseFloat(rows[0].revenue),
      last30d:   parseInt(rows[0].last30d, 10),
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/admin/subscriptions
//  Course subscriptions list (excludes Partnership)
//  Query: ?status=paid|pending|refunded&search=text&page=1&limit=20
// ─────────────────────────────────────────────────────────────────────────────
router.get('/subscriptions', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, search } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const params = [];
    const conds  = [`o.product != 'Partnership'`];

    if (status) { params.push(status);        conds.push(`o.status = $${params.length}`); }
    if (search) { params.push(`%${search}%`); conds.push(`(u.email ILIKE $${params.length} OR u.name ILIKE $${params.length})`); }

    const where = `WHERE ${conds.join(' AND ')}`;

    const { rows: countRows } = await query(
      `SELECT COUNT(*) AS total FROM orders o JOIN users u ON u.id = o.user_id ${where}`,
      params,
    );

    // Total lessons (for progress %)
    const { rows: lessonTotal } = await query('SELECT COUNT(*) AS cnt FROM lessons');
    const totalLessons = parseInt(lessonTotal[0]?.cnt ?? 0, 10);

    params.push(parseInt(limit, 10));
    params.push(offset);

    const { rows } = await query(
      `SELECT o.id, o.product, o.amount, o.promo_code, o.status, o.created_at, o.paid_at,
              u.email AS buyer_email, u.name AS buyer_name, u.id AS user_id,
              COALESCE(cp.completed_count, 0) AS completed_lessons
       FROM orders o
       JOIN users u ON u.id = o.user_id
       LEFT JOIN (
         SELECT user_id, COUNT(*) FILTER (WHERE completed = true) AS completed_count
         FROM course_progress
         GROUP BY user_id
       ) cp ON cp.user_id = o.user_id
       ${where}
       ORDER BY o.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    res.json({
      subscriptions: rows,
      total:         parseInt(countRows[0].total, 10),
      totalLessons,
      page:          parseInt(page, 10),
      limit:         parseInt(limit, 10),
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  PARTNER APPLICATIONS
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/admin/applications
router.get('/applications', async (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const params = [];
    const conds  = [];

    if (status) { params.push(status);        conds.push(`a.status = $${params.length}`); }
    if (search) { params.push(`%${search}%`); conds.push(`(a.name ILIKE $${params.length} OR a.email ILIKE $${params.length} OR a.telegram ILIKE $${params.length})`); }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const { rows: countRows } = await query(
      `SELECT COUNT(*) AS total FROM partner_applications a ${where}`, params,
    );

    params.push(parseInt(limit, 10));
    params.push(offset);

    const { rows } = await query(
      `SELECT a.*
       FROM partner_applications a
       ${where}
       ORDER BY
         CASE a.status WHEN 'pending' THEN 0 ELSE 1 END,
         a.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    res.json({ applications: rows, total: parseInt(countRows[0].total, 10) });
  } catch (err) { next(err); }
});

// PATCH /api/admin/applications/:id  — approve or reject
router.patch('/applications/:id', async (req, res, next) => {
  try {
    const { status, reject_reason } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Неверный статус' });
    }

    const { rows } = await query(
      `UPDATE partner_applications
       SET status = $1, reject_reason = $2, reviewed_at = NOW(), reviewed_by = $3
       WHERE id = $4
       RETURNING *`,
      [status, reject_reason || null, req.user.id, req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Не найдено' });

    // Auto-create partner record when approved
    if (status === 'approved' && rows[0].user_id && rows[0].slug) {
      const promoCode = rows[0].slug.toUpperCase();
      await query(
        `INSERT INTO partners (user_id, slug, promo_code)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO NOTHING`,
        [rows[0].user_id, rows[0].slug, promoCode],
      ).catch(e => console.error('partner create error:', e));
    }

    res.json({ application: rows[0] });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
//  PROMO CODES
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/admin/promo-codes
router.get('/promo-codes', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT pc.*,
             COUNT(o.id)                                                    AS use_count,
             COALESCE(SUM(o.amount) FILTER (WHERE o.status = 'paid'), 0)   AS revenue
      FROM promo_codes pc
      LEFT JOIN orders o ON o.promo_code = pc.code
      GROUP BY pc.id
      ORDER BY pc.created_at DESC
    `);
    res.json({ codes: rows });
  } catch (err) { next(err); }
});

// POST /api/admin/promo-codes
router.post('/promo-codes', async (req, res, next) => {
  try {
    const { code, discount = 10, expiresAt } = req.body;
    if (!code?.trim()) return res.status(400).json({ error: 'code обязателен' });
    const { rows } = await query(
      `INSERT INTO promo_codes (code, discount_percent, expires_at)
       VALUES ($1, $2, $3) RETURNING *`,
      [code.trim().toUpperCase(), parseInt(discount, 10), expiresAt || null],
    );
    res.json({ code: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Промокод уже существует' });
    next(err);
  }
});

// PATCH /api/admin/promo-codes/:id  — toggle is_active
router.patch('/promo-codes/:id', async (req, res, next) => {
  try {
    const { is_active } = req.body;
    const { rows } = await query(
      `UPDATE promo_codes SET is_active = $1 WHERE id = $2 RETURNING *`,
      [Boolean(is_active), req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Не найден' });
    res.json({ code: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/admin/promo-codes/:id
router.delete('/promo-codes/:id', async (req, res, next) => {
  try {
    await query('DELETE FROM promo_codes WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
//  LESSONS (Content tab)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/admin/lessons/:id  — full lesson detail (topics + videos)
router.get('/lessons/:id', async (req, res, next) => {
  try {
    const { rows: lessonRows } = await query(
      `SELECT l.*,
              COUNT(cp.user_id) FILTER (WHERE cp.completed = true) AS completed_count,
              COUNT(cp.user_id) AS viewed_count
       FROM lessons l
       LEFT JOIN course_progress cp ON cp.lesson_id = l.id
       WHERE l.id = $1
       GROUP BY l.id`,
      [req.params.id],
    );
    if (!lessonRows.length) return res.status(404).json({ error: 'Урок не найден' });

    const [{ rows: topics }, { rows: videos }] = await Promise.all([
      query('SELECT * FROM lesson_topics WHERE lesson_id = $1 ORDER BY sort_order ASC', [req.params.id]),
      query('SELECT * FROM lesson_videos WHERE lesson_id = $1 ORDER BY sort_order ASC', [req.params.id]),
    ]);

    res.json({ lesson: lessonRows[0], topics, videos });
  } catch (err) { next(err); }
});

// GET /api/admin/lessons
router.get('/lessons', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT l.*,
              COUNT(cp.user_id) FILTER (WHERE cp.completed = true) AS completed_count,
              COUNT(cp.user_id) AS viewed_count
       FROM lessons l
       LEFT JOIN course_progress cp ON cp.lesson_id = l.id
       GROUP BY l.id
       ORDER BY l.sort_order ASC`,
    );
    res.json({ lessons: rows, total: rows.length });
  } catch (err) { next(err); }
});

// POST /api/admin/lessons
router.post('/lessons', async (req, res, next) => {
  try {
    const { title } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title обязателен' });

    // Получаем максимальный sort_order
    const { rows: maxRows } = await query('SELECT COALESCE(MAX(sort_order), 0) AS max FROM lessons');
    const nextOrder = parseInt(maxRows[0].max, 10) + 1;

    const { rows } = await query(
      `INSERT INTO lessons (title, sort_order, is_free) VALUES ($1, $2, false) RETURNING *`,
      [title.trim(), nextOrder],
    );
    res.json({ lesson: rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/admin/lessons/:id
router.patch('/lessons/:id', async (req, res, next) => {
  try {
    const { title, sort_order } = req.body;
    const sets = [];
    const params = [];

    if (title !== undefined) { params.push(title.trim()); sets.push(`title = $${params.length}`); }
    if (sort_order !== undefined) { params.push(parseInt(sort_order, 10)); sets.push(`sort_order = $${params.length}`); }

    if (!sets.length) return res.status(400).json({ error: 'Нечего обновлять' });

    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE lessons SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    if (!rows.length) return res.status(404).json({ error: 'Урок не найден' });
    res.json({ lesson: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/admin/lessons/:id
router.delete('/lessons/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      'DELETE FROM lessons WHERE id = $1 RETURNING id',
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Урок не найден' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
//  LESSON TOPICS
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/admin/lessons/:id/topics
router.post('/lessons/:id/topics', async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text обязателен' });
    const { rows: mx } = await query(
      'SELECT COALESCE(MAX(sort_order), 0) AS max FROM lesson_topics WHERE lesson_id = $1',
      [req.params.id],
    );
    const { rows } = await query(
      'INSERT INTO lesson_topics (lesson_id, text, sort_order) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, text.trim(), parseInt(mx[0].max, 10) + 1],
    );
    res.json({ topic: rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/admin/lessons/:id/topics/:topicId
router.patch('/lessons/:id/topics/:topicId', async (req, res, next) => {
  try {
    const { text, sort_order } = req.body;
    const sets = [], params = [];
    if (text !== undefined)       { params.push(text.trim());         sets.push(`text = $${params.length}`); }
    if (sort_order !== undefined) { params.push(parseInt(sort_order, 10)); sets.push(`sort_order = $${params.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'Нечего обновлять' });
    params.push(req.params.topicId);
    const { rows } = await query(
      `UPDATE lesson_topics SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    if (!rows.length) return res.status(404).json({ error: 'Не найдено' });
    res.json({ topic: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/admin/lessons/:id/topics/:topicId
router.delete('/lessons/:id/topics/:topicId', async (req, res, next) => {
  try {
    await query('DELETE FROM lesson_topics WHERE id = $1', [req.params.topicId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
//  LESSON VIDEOS
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/admin/lessons/:id/videos
router.post('/lessons/:id/videos', async (req, res, next) => {
  try {
    const { title, description, video_url, is_main } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title обязателен' });
    const { rows: mx } = await query(
      'SELECT COALESCE(MAX(sort_order), 0) AS max FROM lesson_videos WHERE lesson_id = $1',
      [req.params.id],
    );
    const { rows } = await query(
      `INSERT INTO lesson_videos (lesson_id, title, description, video_url, is_main, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        req.params.id, title.trim(),
        description?.trim() || null, video_url?.trim() || null,
        Boolean(is_main), parseInt(mx[0].max, 10) + 1,
      ],
    );
    res.json({ video: rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/admin/lessons/:id/videos/:videoId
router.patch('/lessons/:id/videos/:videoId', async (req, res, next) => {
  try {
    const { title, description, video_url, is_main, sort_order } = req.body;
    const sets = [], params = [];
    if (title !== undefined)       { params.push(title.trim());            sets.push(`title = $${params.length}`); }
    if (description !== undefined) { params.push(description?.trim()||null); sets.push(`description = $${params.length}`); }
    if (video_url !== undefined)   { params.push(video_url?.trim()||null);  sets.push(`video_url = $${params.length}`); }
    if (is_main !== undefined)     { params.push(Boolean(is_main));         sets.push(`is_main = $${params.length}`); }
    if (sort_order !== undefined)  { params.push(parseInt(sort_order, 10)); sets.push(`sort_order = $${params.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'Нечего обновлять' });
    params.push(req.params.videoId);
    const { rows } = await query(
      `UPDATE lesson_videos SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    if (!rows.length) return res.status(404).json({ error: 'Не найдено' });
    res.json({ video: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/admin/lessons/:id/videos/:videoId
router.delete('/lessons/:id/videos/:videoId', async (req, res, next) => {
  try {
    await query('DELETE FROM lesson_videos WHERE id = $1', [req.params.videoId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
