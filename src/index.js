require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');
const path         = require('path');

const authRoutes    = require('./routes/auth');
const courseRoutes  = require('./routes/courses');
const partnerRoutes = require('./routes/partners');
const adminRoutes   = require('./routes/admin');

const app = express();

// ── CORS (нужен только если фронт на другом домене) ──────────────────────────
// Когда фронт раздаётся тем же Express — CORS не нужен вообще.
// Оставляем на случай локальной разработки или внешнего фронта.
const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return cb(null, true);
    }
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Body / Cookie parsers ─────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Global rate limit (safety net) ───────────────────────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов, попробуйте позже.' },
}));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/courses',  courseRoutes);
app.use('/api/partners', partnerRoutes);
app.use('/api/admin',    adminRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── Static frontend (папка public/ рядом с src/) ──────────────────────────────
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR, {
  // Кешировать статику 1 день, HTML — не кешировать (чтобы обновления сразу видны)
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  },
}));

// ── SPA fallback: любой не-API роут → index.html ─────────────────────────────
// Это позволяет открывать /course.html, /login.html и т.д. напрямую
app.get('*', (req, res) => {
  // Если это API-запрос без совпадения — 404 JSON
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅  Server listening on port ${PORT}  [${process.env.NODE_ENV || 'development'}]`);
  console.log(`📁  Serving static files from: ${PUBLIC_DIR}`);
});
