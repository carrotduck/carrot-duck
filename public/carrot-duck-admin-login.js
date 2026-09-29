(() => {
  if (location.pathname !== '/admin') return;
  const storageKey = 'carrotduck_admin_key';
  const nativeFetch = window.fetch.bind(window);
  let formHost;

  function showLogin() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', showLogin, { once: true }); return; }
    document.documentElement.classList.add('cd-admin-locked');
    if (formHost) return;
    formHost = document.createElement('main');
    formHost.id = 'cd-admin-login';
    formHost.innerHTML = `
      <h1>Research Admin</h1>
      <form><label for="cd-admin-password">Admin key</label>
      <input id="cd-admin-password" type="password" autocomplete="current-password" required spellcheck="false" autocapitalize="none">
      <button type="submit">Sign in</button><p role="status" aria-live="polite"></p></form>`;
    document.body.append(formHost);
    formHost.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      const input = formHost.querySelector('input'), button = formHost.querySelector('button'), status = formHost.querySelector('[role=status]');
      const key = input.value.trim();
      if (!key || button.disabled) return;
      button.disabled = true; status.textContent = 'Signing in...';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await nativeFetch('/api/admin/overview', {
          headers: { 'X-Admin-Key': key }, cache: 'no-store', signal: controller.signal,
        });
        response.body?.cancel().catch(() => {});
        if (!response.ok) {
          status.textContent = [401, 403].includes(response.status) ? 'Invalid admin key. Please try again.' : 'Admin service unavailable. Please try again.';
          return;
        }
        sessionStorage.setItem(storageKey, key);
        input.value = '';
        location.reload();
      } catch {
        status.textContent = 'Could not connect. Please try again.';
      } finally { clearTimeout(timeout); button.disabled = false; }
    };
  }

  const style = document.createElement('style');
  style.textContent = `
    .cd-admin-locked #root,.cd-admin-locked .cd-admin-extra{display:none!important}
    #cd-admin-login{box-sizing:border-box;width:min(420px,100%);margin:64px auto;padding:24px;font:16px system-ui;letter-spacing:0;color:#243128}
    #cd-admin-login h1{font-size:26px;margin:18px 0 28px}
    #cd-admin-login label{display:block;margin-bottom:8px}
    #cd-admin-login input{display:block;box-sizing:border-box;width:100%;padding:12px;border:1px solid #82978b;border-radius:6px;font:inherit;background:white;color:#243128}
    #cd-admin-login button{width:100%;margin-top:16px;padding:12px;border:0;border-radius:6px;background:#347153;color:white;font:inherit;cursor:pointer}
    #cd-admin-login button:disabled{opacity:.6;cursor:wait}
    #cd-admin-login p{min-height:24px;line-height:1.5;color:#a32330;overflow-wrap:anywhere}
  `;
  document.head.append(style);
  window.fetch = async (input, init) => {
    const response = await nativeFetch(input, init);
    const url = new URL(input instanceof Request ? input.url : input, location.origin);
    if (url.origin === location.origin && /^\/api\/admin(?:\/|$)/.test(url.pathname) && [401, 403].includes(response.status)) {
      sessionStorage.removeItem(storageKey);
      showLogin();
    }
    return response;
  };
  const supplied = sessionStorage.getItem(storageKey) || new URL(location.href).searchParams.get('key');
  if (!supplied) showLogin();
})();
