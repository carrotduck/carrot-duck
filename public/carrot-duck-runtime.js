(() => {
  if (location.pathname === '/admin') {
    const storageKey = 'carrotduck_admin_key';
    const nativeFetch = window.fetch.bind(window);
    const url = new URL(location.href);
    const incomingKey = url.searchParams.get('key');
    if (incomingKey) {
      sessionStorage.setItem(storageKey, incomingKey);
      url.searchParams.delete('key');
      history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
    window.fetch = (input, init = {}) => {
      const requestUrl = new URL(input instanceof Request ? input.url : input, location.origin);
      if (requestUrl.origin !== location.origin || !requestUrl.pathname.startsWith('/api/admin')) {
        return nativeFetch(input, init);
      }
      const queryKey = requestUrl.searchParams.get('key');
      if (queryKey) sessionStorage.setItem(storageKey, queryKey);
      requestUrl.searchParams.delete('key');
      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));
      const key = sessionStorage.getItem(storageKey);
      if (key) headers.set('X-Admin-Key', key);
      return nativeFetch(requestUrl.toString(), { ...init, headers });
    };
    return;
  }

  const USER_ID_KEY = 'carrotduck_user_id';
  const SESSION_KEY = 'carrotduck_session_token';
  const RECOVERY_KEY = 'carrotduck_recovery_key';
  const nativeFetch = window.fetch.bind(window);
  let bootstrapPromise = null;
  const clockFormatters = new Map();

  window.carrotDuckFormatClock = (date, lang) => {
    const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
    if (!clockFormatters.has(locale)) {
      clockFormatters.set(locale, new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }));
    }
    return clockFormatters.get(locale).format(date);
  };

  function removeLegacyUid() {
    try {
      const url = new URL(location.href);
      if (!url.searchParams.has('uid')) return;
      url.searchParams.delete('uid');
      history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    } catch { /* ignore malformed location */ }
  }

  function storeCredentials(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (payload.user?.id) localStorage.setItem(USER_ID_KEY, payload.user.id);
    if (payload.session_token) localStorage.setItem(SESSION_KEY, payload.session_token);
    if (payload.recovery_key) localStorage.setItem(RECOVERY_KEY, payload.recovery_key);
  }

  async function captureCredentials(response, url) {
    if (!response?.ok) return;
    if (!/^\/api\/users\/(?:onboarding|recover|user\/)/.test(url.pathname)) return;
    const type = response.headers.get('content-type') || '';
    if (!type.includes('application/json')) return;
    try { storeCredentials(await response.clone().json()); } catch { /* response remains usable */ }
  }

  function isPublicApi(pathname) {
    return pathname === '/api/health'
      || pathname === '/api/users/onboarding'
      || pathname === '/api/users/recover'
      || pathname === '/api/push/vapid-public-key';
  }

  async function ensureLegacySession() {
    const token = localStorage.getItem(SESSION_KEY);
    const userId = localStorage.getItem(USER_ID_KEY);
    if (token || !userId) return token;
    if (!bootstrapPromise) {
      bootstrapPromise = nativeFetch(`/api/users/user/${encodeURIComponent(userId)}`)
        .then(async (response) => {
          await captureCredentials(response, new URL(response.url));
          return localStorage.getItem(SESSION_KEY);
        })
        .finally(() => { bootstrapPromise = null; });
    }
    return bootstrapPromise;
  }

  window.fetch = async (input, init = {}) => {
    const rawUrl = input instanceof Request ? input.url : input;
    const url = new URL(rawUrl, location.origin);
    const isApi = url.origin === location.origin && url.pathname.startsWith('/api/');
    if (!isApi || url.pathname.startsWith('/api/admin')) return nativeFetch(input, init);

    if (!isPublicApi(url.pathname) && !/^\/api\/users\/user\/[^/]+$/.test(url.pathname)) {
      await ensureLegacySession();
    }

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));
    const token = localStorage.getItem(SESSION_KEY);
    if (token) headers.set('Authorization', `Bearer ${token}`);

    const response = await nativeFetch(input, { ...init, headers });
    await captureCredentials(response, url);
    if (response.status === 403) {
      window.dispatchEvent(new CustomEvent('carrotduck-account-mismatch'));
    }
    return response;
  };

  window.carrotDuckAccount = {
    getRecoveryKey: () => localStorage.getItem(RECOVERY_KEY),
    clear: () => {
      localStorage.removeItem(USER_ID_KEY);
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(RECOVERY_KEY);
      removeLegacyUid();
    },
  };

  removeLegacyUid();
})();
