(() => {
  if (window !== window.top || location.pathname !== '/') return;
  function mount() {
    const link = document.createElement('a'); link.href = '/autonomous.html'; link.textContent = '自主互动 · Autonomous';
    link.style.cssText = 'position:fixed;left:12px;top:12px;z-index:2147482490;padding:8px 12px;border:1px solid #bdbfaf;border-radius:20px;background:#fffdf5;color:#4c5941;font:12px system-ui;text-decoration:none';
    link.title = 'Memory retrieval, generated replies and performance inspection'; document.body.append(link);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
})();
