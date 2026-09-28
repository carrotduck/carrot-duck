(() => {
  const status = document.getElementById('status');
  const next = document.getElementById('continue');
  if (localStorage.getItem('carrotduck_session_token')) next.hidden = false;
  async function request(path, body) {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Request failed');
    if (data.user?.id) localStorage.setItem('carrotduck_user_id', data.user.id);
    if (data.session_token) localStorage.setItem('carrotduck_session_token', data.session_token);
    next.hidden = false;
    status.textContent = data.recovery_key ? 'Account created. Keep this recovery key private: ' + data.recovery_key : 'Account restored.';
  }
  document.getElementById('create').onsubmit = async event => {
    event.preventDefault(); const button = document.getElementById('create-button'); button.disabled = true;
    status.textContent = 'Creating account…';
    try { await request('/api/users/onboarding', { name: document.getElementById('name').value.trim(), ai_name: 'Duck', keywords: { warmth: 'warm', energy: 'steady', initiative: 'reactive', expression: 'subtle', distance: 'independent' }, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }); }
    catch (error) { status.textContent = error.message; } finally { button.disabled = false; }
  };
  document.getElementById('recover').onsubmit = async event => {
    event.preventDefault();
    try { await request('/api/users/recover', { recovery_key: document.getElementById('recovery').value.trim() }); }
    catch (error) { status.textContent = error.message; }
  };
})();
