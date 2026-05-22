const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// All course routes require authentication
router.use(requireAuth);

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/courses/lessons
//  Returns all lessons (locked/unlocked based on whether user has paid)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/lessons', async (req, res, next) => {
  try {
    // Check if user has an active purchase
    const purchaseRes = await query(
      `SELECT id FROM orders WHERE user_id = $1 AND status = 'paid' LIMIT 1`,
      [req.user.id],
    );
    const hasPurchased = purchaseRes.rows.length > 0 || req.user.role === 'admin';

    const { rows: lessons } = await query(
      'SELECT id, title, sort_order, is_free FROM lessons ORDER BY sort_order',
    );

    // Attach progress
    const { rows: progress } = await query(
      'SELECT lesson_id, viewed, completed FROM course_progress WHERE user_id = $1',
      [req.user.id],
    );
    const progressMap = {};
    for (const p of progress) progressMap[p.lesson_id] = p;

    const result = lessons.map(l => ({
      ...l,
      unlocked: l.is_free || hasPurchased,
      viewed:    progressMap[l.id]?.viewed    ?? false,
      completed: progressMap[l.id]?.completed ?? false,
    }));

    res.json({ lessons: result, hasPurchased });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/courses/progress
//  Returns progress summary for the current user
// ─────────────────────────────────────────────────────────────────────────────
router.get('/progress', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT cp.lesson_id, cp.viewed, cp.completed, cp.viewed_at, cp.completed_at,
              l.title, l.sort_order
       FROM course_progress cp
       JOIN lessons l ON l.id = cp.lesson_id
       WHERE cp.user_id = $1
       ORDER BY l.sort_order`,
      [req.user.id],
    );

    const { rows: total } = await query('SELECT COUNT(*) AS cnt FROM lessons');
    const totalLessons    = parseInt(total[0].cnt, 10);
    const completedCount  = rows.filter(r => r.completed).length;
    const viewedCount     = rows.filter(r => r.viewed).length;
    const lastActivity    = rows
      .map(r => r.completed_at || r.viewed_at)
      .filter(Boolean)
      .sort()
      .pop() || null;

    res.json({
      progress:      rows,
      totalLessons,
      completedCount,
      viewedCount,
      lastActivity,
      percentage:    totalLessons ? Math.round((completedCount / totalLessons) * 100) : 0,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/courses/progress
//  Body: { lessonId, viewed?, completed? }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/progress', async (req, res, next) => {
  try {
    const { lessonId, viewed, completed } = req.body;

    if (!lessonId) return res.status(400).json({ error: 'lessonId обязателен.' });

    // Check lesson exists
    const { rows: lesson } = await query('SELECT id, is_free FROM lessons WHERE id = $1', [lessonId]);
    if (!lesson.length) return res.status(404).json({ error: 'Урок не найден.' });

    // Check access (paid or free)
    if (!lesson[0].is_free && req.user.role !== 'admin') {
      const purchase = await query(
        `SELECT id FROM orders WHERE user_id = $1 AND status = 'paid' LIMIT 1`,
        [req.user.id],
      );
      if (!purchase.rows.length) {
        return res.status(403).json({ error: 'Нет доступа к этому уроку.' });
      }
    }

    const sets = [];
    const vals = [req.user.id, lessonId];

    if (viewed !== undefined) {
      sets.push(`viewed = $${vals.length + 1}`);
      vals.push(Boolean(viewed));
      if (viewed) {
        sets.push(`viewed_at = COALESCE(viewed_at, NOW())`);
      }
    }
    if (completed !== undefined) {
      sets.push(`completed = $${vals.length + 1}`);
      vals.push(Boolean(completed));
      if (completed) {
        sets.push(`completed_at = COALESCE(completed_at, NOW())`);
        // Auto-mark as viewed when completed
        sets.push(`viewed = TRUE`);
        sets.push(`viewed_at = COALESCE(viewed_at, NOW())`);
      }
    }

    if (!sets.length) return res.status(400).json({ error: 'Нет данных для обновления.' });

    await query(
      `INSERT INTO course_progress (user_id, lesson_id, ${viewed !== undefined ? 'viewed,' : ''} ${completed !== undefined ? 'completed,' : ''} viewed_at, completed_at)
       VALUES ($1, $2, ${viewed !== undefined ? `${Boolean(viewed)},` : ''} ${completed !== undefined ? `${Boolean(completed)},` : ''} ${viewed ? 'NOW(),' : 'NULL,'} ${completed ? 'NOW()' : 'NULL'})
       ON CONFLICT (user_id, lesson_id) DO UPDATE SET ${sets.join(', ')}`,
      vals,
    );

    res.json({ message: 'Прогресс сохранён.' });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  DELETE /api/courses/progress  (reset — for testing / admin)
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/progress', async (req, res, next) => {
  try {
    // Only admin can reset another user's progress; users reset own
    const targetUserId = req.user.role === 'admin' && req.body.userId
      ? req.body.userId
      : req.user.id;

    await query('DELETE FROM course_progress WHERE user_id = $1', [targetUserId]);
    res.json({ message: 'Прогресс сброшен.' });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/courses/orders
//  История заказов текущего пользователя
// ─────────────────────────────────────────────────────────────────────────────
router.get('/orders', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, plan, amount, original_amount, promo_code, status, created_at
       FROM orders
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id],
    );
    res.json({ orders: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
