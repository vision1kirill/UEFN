# Деплой на Railway

## Структура проекта

```
backend/
├── src/
│   ├── index.js              # Точка входа (Express server)
│   ├── db.js                 # PostgreSQL pool
│   ├── middleware/
│   │   └── auth.js           # JWT auth middleware
│   ├── routes/
│   │   ├── auth.js           # /api/auth/*
│   │   ├── courses.js        # /api/courses/*
│   │   ├── partners.js       # /api/partners/*
│   │   └── admin.js          # /api/admin/*
│   └── utils/
│       ├── jwt.js            # Генерация/проверка токенов
│       ├── otp.js            # OTP коды
│       └── email.js          # Отправка писем
├── schema.sql                # SQL схема БД
├── package.json
├── railway.toml
└── .env.example              # Шаблон переменных окружения
```

---

## Шаг 1 — Создать проект на Railway

1. Зайдите на [railway.app](https://railway.app) → New Project
2. Выберите **Deploy from GitHub repo** (или загрузите через CLI)
3. Добавьте сервис **PostgreSQL** (кнопка "+ New" → Database → PostgreSQL)

---

## Шаг 2 — Загрузить код

### Вариант А: через GitHub (рекомендуется)
```bash
# В папке backend/
git init
git add .
git commit -m "Initial backend"
git remote add origin https://github.com/YOUR_USER/uefn-backend.git
git push -u origin main
```
Затем в Railway: Connect Repo → выберите репозиторий.

### Вариант Б: Railway CLI
```bash
npm install -g @railway/cli
railway login
railway link          # привязать к существующему проекту
railway up            # задеплоить
```

---

## Шаг 3 — Переменные окружения

В Railway → ваш сервис → Variables, добавьте:

| Переменная | Значение |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | *Автоматически из PostgreSQL сервиса* |
| `JWT_SECRET` | Случайная строка ≥ 64 символа |
| `JWT_ACCESS_EXPIRES` | `15m` |
| `JWT_REFRESH_EXPIRES` | `30d` |
| `SMTP_HOST` | `smtp.yandex.ru` (или ваш SMTP) |
| `SMTP_PORT` | `465` |
| `SMTP_SECURE` | `true` |
| `SMTP_USER` | `noreply@yourdomain.ru` |
| `SMTP_PASS` | Пароль приложения |
| `EMAIL_FROM` | `"UEFN с нуля" <noreply@yourdomain.ru>` |
| `FRONTEND_URL` | `https://yourdomain.ru` |
| `OTP_EXPIRES_MINUTES` | `10` |

> **DATABASE_URL** Railway вставляет автоматически если PostgreSQL в том же проекте.

Для генерации JWT_SECRET:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## Шаг 4 — Инициализация БД

После первого деплоя выполните schema.sql:

### Через Railway CLI:
```bash
railway run psql $DATABASE_URL -f schema.sql
```

### Через psql напрямую:
```bash
# DATABASE_URL берётся из Railway → PostgreSQL → Connect
psql "postgresql://..." -f schema.sql
```

---

## Шаг 5 — Создать первого администратора

```bash
# После выполнения schema.sql
railway run node -e "
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
bcrypt.hash('YOUR_ADMIN_PASSWORD', 12).then(hash =>
  pool.query(
    \`INSERT INTO users (email, password_hash, name, role, email_verified)
     VALUES ('admin@yourdomain.ru', '\${hash}', 'Admin', 'admin', TRUE)\`
  ).then(() => { console.log('Admin created'); pool.end(); })
);
"
```

---

## API эндпоинты

### Auth
| Метод | URL | Описание |
|---|---|---|
| POST | `/api/auth/register` | Регистрация |
| POST | `/api/auth/login` | Вход |
| POST | `/api/auth/logout` | Выход |
| POST | `/api/auth/send-otp` | Отправить OTP |
| POST | `/api/auth/verify-otp` | Проверить OTP |
| POST | `/api/auth/refresh` | Обновить access token |
| POST | `/api/auth/reset-password` | Сброс пароля |
| GET | `/api/auth/me` | Текущий пользователь |

### Courses (требует auth)
| Метод | URL | Описание |
|---|---|---|
| GET | `/api/courses/lessons` | Список уроков с прогрессом |
| GET | `/api/courses/progress` | Сводка прогресса |
| POST | `/api/courses/progress` | Сохранить прогресс |

### Partners (требует auth)
| Метод | URL | Описание |
|---|---|---|
| GET | `/api/partners/check-slug?slug=xxx` | Проверить уникальность слага |
| POST | `/api/partners/apply` | Подать заявку |
| GET | `/api/partners/me` | Профиль партнёра |
| GET | `/api/partners/purchases` | Покупки по рефералу |
| GET | `/api/partners/referrals` | Рефералы |
| GET | `/api/partners/payouts` | История выплат |
| POST | `/api/partners/payouts` | Запросить выплату |

### Admin (требует role=admin)
| Метод | URL | Описание |
|---|---|---|
| GET | `/api/admin/stats` | Общая статистика |
| GET | `/api/admin/users` | Список пользователей |
| GET | `/api/admin/applications` | Заявки партнёров |
| PATCH | `/api/admin/applications/:id` | Одобрить/отклонить |
| GET | `/api/admin/sales` | Продажи |
| GET | `/api/admin/payouts` | Заявки на выплату |
| PATCH | `/api/admin/payouts/:id` | Обработать выплату |

---

## Health check

```
GET /health  →  { "ok": true, "ts": "..." }
```

Railway использует этот эндпоинт для мониторинга (настроен в railway.toml).

---

## Подключение фронтенда к бэкенду

В JS каждой страницы замените `API_BASE` на URL вашего Railway сервиса:

```javascript
const API_BASE = 'https://uefn-backend-production.up.railway.app';

// Пример: логин
const res = await fetch(`${API_BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',   // важно для cookies
  body: JSON.stringify({ email, password }),
});
const data = await res.json();
// data.accessToken → сохранить в localStorage
// data.user → { id, email, name, role }
```
