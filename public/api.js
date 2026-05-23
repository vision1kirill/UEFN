/**
 * api.js — общий модуль для работы с бэкендом
 * Подключать через: <script src="api.js"></script>
 */

// ── Конфигурация ──────────────────────────────────────────────────────────────
// Пустая строка = запросы идут на тот же домен (фронт и API на одном Railway-сервисе).
// Для локальной разработки замените на 'http://localhost:3000'
const API_BASE = '';

// ── Хранилище токена ──────────────────────────────────────────────────────────
const Auth = {
  getToken()         { return localStorage.getItem('access_token'); },
  setToken(t)        { localStorage.setItem('access_token', t); },
  clearToken()       { localStorage.removeItem('access_token'); },

  getUser()          {
    try { return JSON.parse(localStorage.getItem('auth_user') || 'null'); }
    catch { return null; }
  },
  setUser(u)         { localStorage.setItem('auth_user', JSON.stringify(u)); },
  clearUser()        { localStorage.removeItem('auth_user'); },

  saveEmail(email)   { sessionStorage.setItem('pending_email', email); },
  getPendingEmail()  { return sessionStorage.getItem('pending_email') || ''; },
  clearPendingEmail(){ sessionStorage.removeItem('pending_email'); },

  isLoggedIn()       { return !!this.getToken(); },

  /** Сохраняет токен + пользователя после успешного входа/регистрации */
  saveSession(data) {
    if (data.accessToken) this.setToken(data.accessToken);
    if (data.user)        this.setUser(data.user);
  },

  logout() {
    this.clearToken();
    this.clearUser();
    // Fire-and-forget server logout (удаляет refresh cookie)
    fetch(`${API_BASE}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {});
    window.location.href = 'login.html';
  },

  /** Редирект в зависимости от роли */
  redirectByRole(role) {
    if (role === 'admin')   return window.location.href = 'dashboard.html';
    if (role === 'partner') return window.location.href = 'partner-dashboard.html';
    return window.location.href = 'course.html';
  },
};

// ── Универсальный fetch с авто-рефрешем токена ────────────────────────────────
async function apiFetch(path, options = {}) {
  const token = Auth.getToken();

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',   // нужно для refresh cookie
  });

  // Токен истёк → попробуем обновить
  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    if (body.code === 'TOKEN_EXPIRED') {
      const refreshed = await tryRefresh();
      if (refreshed) {
        // Повторить исходный запрос с новым токеном
        const newToken = Auth.getToken();
        const retryRes = await fetch(`${API_BASE}${path}`, {
          ...options,
          headers: {
            ...headers,
            'Authorization': `Bearer ${newToken}`,
          },
          credentials: 'include',
        });
        return retryRes;
      } else {
        Auth.clearToken();
        Auth.clearUser();
        window.location.href = 'login.html';
        throw new Error('Сессия истекла.');
      }
    }
    // Другая 401 — просто вернуть ответ
    return { ok: false, status: 401, json: async () => body };
  }

  return res;
}

async function tryRefresh() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (data.accessToken) {
      Auth.setToken(data.accessToken);
      if (data.user) Auth.setUser(data.user);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ── Утилиты для UI ────────────────────────────────────────────────────────────

/** Показать ошибку в элементе. el — строка-id или DOM-элемент */
function showError(el, message) {
  const node = typeof el === 'string' ? document.getElementById(el) : el;
  if (!node) return;
  node.textContent = message;
  node.style.display = message ? '' : 'none';
}

/** Спрятать ошибку */
function hideError(el) {
  showError(el, '');
}

/** Блокировать/разблокировать кнопку отправки */
function setLoading(btn, isLoading, originalText) {
  if (!btn) return;
  btn.disabled = isLoading;
  btn.textContent = isLoading ? 'Загрузка...' : originalText;
}

/** Получить сообщение об ошибке из ответа API */
async function extractError(res) {
  try {
    const data = await res.json();
    return data.error || 'Неизвестная ошибка. Попробуйте ещё раз.';
  } catch {
    return `Ошибка сервера (${res.status}). Попробуйте позже.`;
  }
}

// ── Автоматическая инициализация навигации ────────────────────────────────────
// Запускается на любой странице с api.js: обновляет аватарку и badge тарифа
document.addEventListener('DOMContentLoaded', async () => {
  const user = Auth.getUser();
  if (!user) return;

  const PLAN_LABELS = { essential: 'Essential', extra: 'Extra', deluxe: 'Deluxe' };
  const ROLE_HREF   = { admin: 'dashboard.html', partner: 'partner-dashboard.html' };
  const ROLE_BADGE  = { admin: 'Admin', partner: 'Partner' };

  // Обновляем все ссылки-аватарки (desktop + mobile)
  document.querySelectorAll('a.nav__avatar').forEach(link => {
    const dest = ROLE_HREF[user.role];
    if (dest) link.href = dest;
  });

  // Обновляем badge тарифа
  const badges = document.querySelectorAll('.nav__plan-badge');
  if (!badges.length) return;

  if (ROLE_BADGE[user.role]) {
    // Админ или партнёр — показываем роль
    badges.forEach(b => { b.textContent = ROLE_BADGE[user.role]; b.style.display = ''; });
  } else {
    // Обычный пользователь — подтягиваем реальный тариф из API
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        headers: Auth.getToken() ? { 'Authorization': `Bearer ${Auth.getToken()}` } : {},
        credentials: 'include',
      });
      if (res.ok) {
        const me = await res.json();
        const plan = me.course_plan;
        if (plan && PLAN_LABELS[plan]) {
          badges.forEach(b => { b.textContent = PLAN_LABELS[plan]; b.style.display = ''; });
        }
      }
    } catch (_) { /* нет подписки — badge не показываем */ }
  }
});

// Экспортируем в глобальную область видимости
window.API_BASE  = API_BASE;
window.Auth      = Auth;
window.apiFetch  = apiFetch;
window.showError = showError;
window.hideError = hideError;
window.setLoading = setLoading;
window.extractError = extractError;
