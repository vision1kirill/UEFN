-- =============================================================================
--  UEFN с нуля — PostgreSQL schema
--  Run once on a fresh database:  psql $DATABASE_URL -f schema.sql
-- =============================================================================

-- ── Extensions ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  email          VARCHAR(255) UNIQUE NOT NULL,
  password_hash  VARCHAR(255)        NOT NULL,
  name           VARCHAR(255),
  role           VARCHAR(50)         NOT NULL DEFAULT 'user',  -- user | partner | admin
  email_verified BOOLEAN             NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users (role);

-- ── OTP codes ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_codes (
  id         SERIAL PRIMARY KEY,
  email      VARCHAR(255) NOT NULL,
  code       VARCHAR(6)   NOT NULL,
  purpose    VARCHAR(50)  NOT NULL,  -- verify_email | login | reset_password
  expires_at TIMESTAMPTZ  NOT NULL,
  used       BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_email_purpose ON otp_codes (email, purpose);

-- ── Refresh tokens ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users (id) ON DELETE CASCADE,
  token_hash VARCHAR(255) UNIQUE NOT NULL,  -- SHA-256 of the raw token
  expires_at TIMESTAMPTZ  NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens (user_id);

-- ── Course lessons ────────────────────────────────────────────────────────────
-- Static seed data; add more lessons as content grows
CREATE TABLE IF NOT EXISTS lessons (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(255) NOT NULL,
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  is_free     BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO lessons (id, title, sort_order, is_free) VALUES
  (1, 'Введение в UEFN',                   1, TRUE),
  (2, 'Интерфейс и базовые инструменты',   2, FALSE),
  (3, 'Работа с ландшафтом',               3, FALSE),
  (4, 'Verse: основы программирования',    4, FALSE),
  (5, 'Создание игровых механик',          5, FALSE),
  (6, 'Публикация острова',                6, FALSE)
ON CONFLICT (id) DO NOTHING;

-- ── Course progress ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS course_progress (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES users (id) ON DELETE CASCADE,
  lesson_id    INTEGER REFERENCES lessons (id),
  viewed       BOOLEAN     NOT NULL DEFAULT FALSE,
  completed    BOOLEAN     NOT NULL DEFAULT FALSE,
  viewed_at    TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE (user_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_progress_user ON course_progress (user_id);

-- ── Partner applications ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS partner_applications (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER REFERENCES users (id),
  name              VARCHAR(255),
  email             VARCHAR(255),
  telegram          VARCHAR(255),
  cooperation_type  VARCHAR(50),  -- partner | ambassador | affiliate
  audience          TEXT,
  about             TEXT,
  experience        TEXT,
  social_links      TEXT,
  traffic_source    TEXT,
  motivation        TEXT,
  comment           TEXT,
  slug              VARCHAR(64) UNIQUE,
  status            VARCHAR(50) NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  reject_reason     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at       TIMESTAMPTZ,
  reviewed_by       INTEGER REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS idx_app_status ON partner_applications (status);
CREATE INDEX IF NOT EXISTS idx_app_email  ON partner_applications (email);

-- ── Partners (approved applicants) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS partners (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES users (id) ON DELETE CASCADE UNIQUE,
  slug         VARCHAR(64) UNIQUE NOT NULL,
  promo_code   VARCHAR(64) UNIQUE NOT NULL,
  balance      NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_earned NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_slug  ON partners (slug);
CREATE INDEX IF NOT EXISTS idx_partner_promo ON partners (promo_code);

-- ── Referrals ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrals (
  id               SERIAL PRIMARY KEY,
  partner_id       INTEGER REFERENCES partners (id),
  referred_user_id INTEGER REFERENCES users (id),
  promo_code       VARCHAR(64),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Orders / Purchases ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER REFERENCES users (id),
  product             VARCHAR(255),
  amount              NUMERIC(12, 2) NOT NULL,
  referral_partner_id INTEGER REFERENCES partners (id),
  promo_code          VARCHAR(64),
  payment_id          VARCHAR(255),  -- external payment provider ID
  status              VARCHAR(50) NOT NULL DEFAULT 'pending',  -- pending | paid | refunded
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_user   ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);

-- ── Partner payouts ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS partner_payouts (
  id                SERIAL PRIMARY KEY,
  partner_id        INTEGER REFERENCES partners (id),
  amount            NUMERIC(12, 2) NOT NULL,
  method            VARCHAR(50)    NOT NULL,  -- card | usdt | sbp
  requisites        TEXT           NOT NULL,
  commission_rate   NUMERIC(5, 4)  NOT NULL,
  commission_amount NUMERIC(12, 2) NOT NULL,
  amount_to_receive NUMERIC(12, 2) NOT NULL,
  status            VARCHAR(50)    NOT NULL DEFAULT 'pending',  -- pending | processing | paid | rejected
  reject_reason     TEXT,
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  processed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payouts_partner ON partner_payouts (partner_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status  ON partner_payouts (status);

-- ── Promo codes (admin-managed, general discount codes) ───────────────────────
CREATE TABLE IF NOT EXISTS promo_codes (
  id               SERIAL PRIMARY KEY,
  code             VARCHAR(64) UNIQUE NOT NULL,
  discount_percent INTEGER        NOT NULL DEFAULT 10,
  expires_at       TIMESTAMPTZ,
  is_active        BOOLEAN        NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promo_code ON promo_codes (code);
