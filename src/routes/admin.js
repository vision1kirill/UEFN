const express = require('express');
const { query } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// All admin routes require auth + admin role
router.use(requireAuth, requireRole('admin'));

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/admin/applications
//  Query: ?status=pending|approved|rejected&page=1&limit=20
// ─────────────────────────────────────────────────────────────────────────────
router.get('/applications', async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    let whereClause = '';
    const params = [];
    if (status) {
      params.push(status);
      whereClause = `WHERE pa.status = $${params.length}`;
    }

    params.push(parseInt(limit, 10));
    params.push(offset);

    const { rows } = await query(
      `SELECT pa.*, u.email AS user_email
       FROM partner_applications pa
       LEFT JOIN users u ON u.id = pa.user_id
       ${whereClause}
       ORDER BY pa.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const { rows: countRows } = await query(
      `SELECT COUNT(*) AS total FROM partner_applications ${whereClause}`,
      status ? [status] : [],
    );

    res.json({
      applications: rows,
      total: parseInt(countRows[0].total, 10),
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  } catch (err) {
    next(err);
  }
});

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
//  PATCH /api/admin/applications/:id
//  Body: { status: 'approved' | 'rejected', rejectReason? }
//  On approval: creates partner record + updates user role
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/applications/:id', async (req, res, next) => {
  const client = await require('../db').getClient();
  try {
    const { status, rejectReason } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'status должен быть approved или rejected.' });
    }

    // Fetch application
    const { rows: app } = await client.query(
      'SELECT * FROM partner_applications WHERE id = $1',
      [req.params.id],
    );
    if (!app.length) return res.status(404).json({ error: 'Заявка не найдена.' });
    const application = app[0];

    if (application.status !== 'pending') {
      return res.status(400).json({ error: 'Заявка уже рассмотрена.' });
    }

    await client.query('BEGIN');

    // Update application status
    await client.query(
      `UPDATE partner_applications
       SET status = $1, reject_reason = $2, reviewed_at = NOW(), reviewed_by = $3
       WHERE id = $4`,
      [status, rejectReason || null, req.user.id, req.params.id],
    );

    if (status === 'approved') {
      // Find or create user for this email
      let userId = application.user_id;

      if (!userId) {
        const { rows: existingUser } = await client.query(
          'SELECT id FROM users WHERE email = $1',
          [application.email],
        );
        if (existingUser.length) {
          userId = existingUser[0].id;
        }
        // If user doesn't exist yet they'll need to register separately
      }

      // Create partner record
      const promoCode = application.slug.replace(/-/g, '').toUpperCase() + '15';

      await client.query(
        `INSERT INTO partners (user_id, slug, promo_code)
         VALUES ($1, $2, $3)
         ON CONFLICT (slug) DO NOTHING`,
        [userId, application.slug, promoCode],
      );

      // Update user role to partner
      if (userId) {
        await client.query(
          `UPDATE users SET role = 'partner', updated_at = NOW() WHERE id = $1`,
          [userId],
        );
      }
    }

    await client.query('COMMIT');

    res.json({ message: `Заявка ${status === 'approved' ? 'одобрена' : 'отклонена'}.` });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
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
    const days = parseInt(req.query.days, 10) || 14;
    const { rows } = await query(
      `SELECT
         DATE(paid_at) AS day,
         product,
         COUNT(*)::int AS count,
         SUM(amount)::numeric AS revenue
       FROM orders
       WHERE status = 'paid'
         AND paid_at >= NOW() - ($1 || ' days')::interval
       GROUP BY DATE(paid_at), product
       ORDER BY day ASC`,
      [days],
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
    const { page = 1, limit = 20, status, from, to, search } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const params = [];
    const conds  = [];

    if (status) { params.push(status);        conds.push(`o.status = $${params.length}`); }
    if (from)   { params.push(from);           conds.push(`o.created_at >= $${params.length}::date`); }
    if (to)     { params.push(to);             conds.push(`o.created_at < ($${params.length}::date + interval '1 day')`); }
    if (search) { params.push(`%${search}%`);  conds.push(`(u.email ILIKE $${params.length} OR u.name ILIKE $${params.length})`); }

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

module.exports = router;
