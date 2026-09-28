(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const userId = localStorage.getItem('carrotduck_user_id');
  const endpoint = `/api/chat/${encodeURIComponent(userId || '')}/autonomous`;
  let abort = null, epoch = 0, voiceTurn = null, signedIn = false, ready = false;
  let playbackTurn = null, playbackTimer = null, playbackState = 'idle', ears = false, feedbackQueue = Promise.resolve();
  function report(turnId, status) {
    if (!turnId || !validAccount()) return;
    feedbackQueue = feedbackQueue.catch(() => {}).then(() => api(`${endpoint}/feedback`, {
      method: 'POST', keepalive: true, signal: AbortSignal.timeout(4000), body: JSON.stringify({ turn_id: turnId, status })
    })).catch(() => { $('playback').textContent = '播放反馈暂未同步；下一轮不能确认执行结果。'; });
  }
  const stage = payload => $('stage').contentWindow?.postMessage({ type: 'carrotduck-live2d', ...payload }, location.origin);
  const validAccount = () => localStorage.getItem('carrotduck_user_id') === userId;
  const setStatus = text => { $('status').textContent = text; };
  function bubble(who, text) {
    const row = document.createElement('div'); row.className = `bubble ${who}`;
    const label = document.createElement('span'); label.className = 'who'; label.textContent = who === 'user' ? 'You' : 'Duck';
    row.append(label, document.createTextNode(text)); $('messages').append(row); $('messages').scrollTop = $('messages').scrollHeight;
  }
  function inspect(result) {
    const t = result.trace;
    const lines = [`模式：自主生成（非固定排练）`, `动作：${t.action}`, `选择说明（模型输出）：${t.selection_note || '—'}`,
      `表演意图：${t.performance?.intent || '—'}；表情：${t.performance?.face || '—'}；耳朵：${t.performance?.ears || '—'}`,
      `呈现方式：${t.performance?.mode || 'conversation'}；最近播放反馈：${t.execution_feedback?.[0]?.status || '尚无'}`,
      `本轮允许检索：${t.memory_enabled ? '是' : '否'}`, `检索查询：${t.queries.join(' / ') || '无'}`,
      `候选记忆：${t.candidates.length} 条；模型声明使用：${t.used.length} 条`,
      ...t.used.map(m => `\n使用来源 ${m.id}\n${m.content}\n${m.source_type} · ${m.created_at || ''}`),
      '\n候选记录（检索命中或近期真实记录，不等于实际引用）：', ...t.candidates.map(m => `${m.id} [${m.retrieval.join(', ')}] ${m.content}`),
      '\n来源 ID 已核对，但模型对内容的理解仍可能出错。'];
    $('trace').textContent = lines.join('\n');
  }
  async function api(path, options = {}) {
    const r = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
    const data = await r.json();
    if (!r.ok) throw new Error(r.status === 401 ? '请先回到鸭鸭主页登录已有账号。' : data.error || '请求失败');
    return data;
  }
  function stop() {
    if (playbackTurn) { report(playbackTurn, 'cancelled'); playbackState = 'cancelled'; }
    playbackTurn = null; clearTimeout(playbackTimer);
    epoch++; abort?.abort(); abort = null; voiceTurn = null;
    stage({ state: 'stop' }); stage({ state: 'idle' });
    $('send').disabled = !signedIn; setStatus('已停止。');
  }
  api('/api/demo-config').then(config => {
    if (config.model) $('stage').src = '/live2d-demo.html?embed=1&framing=upper&model=' + encodeURIComponent(config.model);
    $('voice').disabled = !config.voice || !config.model;
  }).catch(() => {});
  $('stage').addEventListener('load', () => { ready = false; stage({ readyRequest: true }); });
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== $('stage').contentWindow || !validAccount()) return;
    if (event.data?.type === 'carrotduck-stage-ready') { ready = true; return; }
    if (event.data?.type === 'carrotduck-performance' && event.data.turnId === playbackTurn) {
      const status = event.data.status;
      if (!['preparing', 'started', 'completed', 'cancelled', 'failed'].includes(status)) return;
      ears = event.data.ears === true;
      playbackState = status === 'started' ? (voiceTurn ? 'speaking' : 'performing') : status;
      $('playback').textContent = ({ preparing: '准备回应', started: '正在表达', completed: '表达完成，正在倾听', cancelled: '表达已打断', failed: '播放未完成' })[status];
      if (status !== 'preparing') report(playbackTurn, status);
      if (['completed', 'cancelled', 'failed'].includes(status)) { playbackTurn = null; clearTimeout(playbackTimer); }
      return;
    }
    if (event.data?.type === 'carrotduck-live2d-voice-end' && event.data.voiceTurnId === voiceTurn) {
      voiceTurn = null; setStatus(event.data.ok ? '说完了，等你继续。' : '语音未能播放，文字已保留；可以关闭朗读后继续。');
    }
  });
  $('chat').addEventListener('submit', async event => {
    event.preventDefault(); if (!signedIn || abort || !validAccount()) return;
    const message = $('message').value.trim(); if (!message) return;
    stop(); const mine = epoch; abort = new AbortController(); $('send').disabled = true;
    const runtime = { mode: $('presentation').value, state: playbackState, ears, ready };
    bubble('user', message); $('message').value = ''; setStatus('正在检索并生成…'); stage({ state: 'thinking' });
    try {
      await feedbackQueue;
      if (mine !== epoch || !validAccount()) return;
      const result = await api(endpoint, { method: 'POST', signal: abort.signal, body: JSON.stringify({ message, request_id: crypto.randomUUID(),
        use_memory: $('memory').checked, lang: $('language').value, runtime }) });
      if (mine !== epoch || !validAccount() || document.hidden) return;
      bubble('assistant', result.reply); inspect(result);
      // Wait for final text to be committed and painted before starting presentation.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (mine !== epoch || !validAccount() || document.hidden) return;
      if (!ready) { report(result.turn_id, 'failed'); playbackState = 'failed'; setStatus('回复已生成。角色未配置或尚未加载；可在下方查看表演计划。'); return; }
      playbackTurn = result.turn_id; playbackState = 'preparing';
      playbackTimer = setTimeout(() => { if (playbackTurn === result.turn_id) { report(playbackTurn, 'failed'); playbackTurn = null; voiceTurn = null; playbackState = 'failed'; stage({ state: 'stop' }); setStatus('播放超时，文字已保留。'); } }, 120000);
      if ($('voice').checked) {
        voiceTurn = result.turn_id;
        stage({ state: 'speak', text: result.reply, expressionPlan: result.expression_plan, voiceTurnId: voiceTurn });
        setStatus('文字已生成，正在准备语音与动作…');
      } else {
        stage({ performance: result.expression_plan.performance, turnId: result.turn_id });
        setStatus('回复与动作已生成。');
      }
    } catch (error) { if (mine === epoch) { stage({ state: 'idle' }); setStatus(error.name === 'AbortError' ? '已停止。' : error.message); } }
    finally { if (mine === epoch) { abort = null; $('send').disabled = !signedIn; } }
  });
  $('remember').addEventListener('submit', async event => {
    event.preventDefault(); if (!signedIn || !validAccount()) return;
    $('save').disabled = true;
    try {
      const data = await api(`${endpoint}/memory`, { method: 'POST', body: JSON.stringify({ content: $('fact').value.trim() }) });
      if (!validAccount()) return;
      $('saved').textContent = `已保存真实记忆，来源 ID：${data.memory.id}`; $('fact').value = '';
    } catch (error) { $('saved').textContent = error.message; }
    finally { $('save').disabled = !signedIn; }
  });
  $('stop').onclick = stop;
  $('presentation').addEventListener('change', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('pagehide', stop);
  window.addEventListener('storage', () => { if (!validAccount()) { signedIn = false; stop(); $('save').disabled = true; $('messages').replaceChildren(); $('trace').textContent = ''; setStatus('账号已切换，请刷新页面。'); } });
  if (!userId) { setStatus('请先回到鸭鸭主页登录已有账号，再打开这里。'); return; }
  api(endpoint).then(data => {
    if (!validAccount()) return;
    signedIn = true; $('send').disabled = $('save').disabled = false;
    for (const turn of data.turns) { bubble('user', turn.message); bubble('assistant', turn.result.reply); }
    if (data.turns.length) inspect(data.turns.at(-1).result);
    setStatus('已连接你的账号。这里使用自主生成，不读取固定排练日记。');
  }).catch(error => setStatus(error.message));
})();
