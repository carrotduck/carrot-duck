(() => {
  if (location.pathname !== '/admin') return;

  const params = new URLSearchParams(location.search);
  const key = sessionStorage.getItem('carrotduck_admin_key') || params.get('key') || '';
  if (!key) return;
  sessionStorage.setItem('carrotduck_admin_key', key);

  const css = document.createElement('style');
  css.textContent = `
    .cd-admin-extra{margin:16px auto 28px;max-width:1180px;padding:14px;border:1px solid #d8dfd4;border-radius:8px;background:#fbfdf8;color:#22281f;font:14px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .cd-admin-extra h2{margin:0 0 10px;font-size:16px;letter-spacing:0}
    .cd-admin-extra h3{margin:0 0 8px;font-size:14px;letter-spacing:0}
    .cd-admin-extra p{margin:6px 0}
    .cd-chart{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
    .cd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
    .cd-card{padding:10px;border:1px solid #e0e6da;border-radius:8px;background:#fff;min-width:0}
    .cd-muted{color:#65705f}
    .cd-section{margin-top:16px}
    .cd-bar{display:flex;align-items:center;gap:8px;margin:7px 0;min-width:0}
    .cd-bar span:first-child{width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .cd-fill{height:10px;border-radius:999px;background:#4f8f6b;min-width:2px}
    .cd-fill.warn{background:#d08b49}
    .cd-fill.risk{background:#bd5b5b}
    .cd-table{width:100%;border-collapse:collapse;font-size:13px}
    .cd-table th,.cd-table td{border-bottom:1px solid #e7ece2;padding:6px;text-align:left;vertical-align:top}
    .cd-pill{display:inline-block;min-width:38px;padding:2px 6px;border-radius:999px;background:#edf5e8;text-align:center;white-space:nowrap}
    .cd-pill.medium{background:#fff1d8}
    .cd-pill.high,.cd-pill.strong{background:#ffe1df}
    .cd-small{font-size:12px;color:#65705f}
    .cd-signal-row{display:grid;grid-template-columns:90px 1fr;gap:6px;margin:5px 0}
    .cd-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:10px}
    .cd-kpi div{padding:8px;border-radius:8px;background:#f2f6ef;border:1px solid #e0e6da}
    .cd-kpi b{display:block;font-size:18px}
  `;
  document.head.appendChild(css);

  const root = document.createElement('section');
  root.className = 'cd-admin-extra';
  root.innerHTML = '<h2>CARROT DUCK Research Console</h2><div class="cd-muted">loading...</div>';
  setTimeout(() => document.body.appendChild(root), 1200);

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function pct(value) {
    return `${Math.round((Number(value) || 0) * 100)}%`;
  }

  function bars(rows, label, keyName, tone = '') {
    const list = rows || [];
    const max = Math.max(1, ...list.map((r) => r.count || 0));
    return `<div class="cd-card"><h3>${esc(label)}</h3>${list.length ? list.map((r) => {
      const name = r[keyName] ?? r.key ?? 'unknown';
      const cls = tone || (name === 'strong' ? 'risk' : name === 'mild' ? 'warn' : '');
      return `<div class="cd-bar"><span title="${esc(name)}">${esc(name)}</span><div class="cd-fill ${cls}" style="width:${Math.round((r.count || 0) / max * 120)}px"></div><b>${r.count || 0}</b></div>`;
    }).join('') : '<p class="cd-muted">No data</p>'}</div>`;
  }

  function pprMap(rows) {
    const top = (rows || []).slice(0, 18);
    return `<div class="cd-card"><h3>PPR Trigger Map</h3>${top.length ? `<table class="cd-table"><thead><tr><th>Depth</th><th>Type</th><th>Full</th><th>Rejected</th><th>Neutral</th><th>Unobs.</th><th>Acc.</th><th>Rate</th></tr></thead><tbody>${top.map((r) => `<tr><td><span class="cd-pill">${esc(r.depth_bucket)}</span></td><td>${esc(r.trigger_label)}</td><td>${r.full || 0}</td><td>${r.rejected || 0}</td><td>${r.neutral || 0}</td><td>${r.expired || 0}</td><td>${r.accidental || 0}</td><td>${pct(r.resonance_rate)}</td></tr>`).join('')}</tbody></table>` : '<p class="cd-muted">No PPR data</p>'}</div>`;
  }

  function boundary(rows) {
    const top = (rows || []).slice(0, 8);
    return `<div class="cd-card"><h3>Perceptual Boundary Probe</h3>${top.length ? `<table class="cd-table"><thead><tr><th>User</th><th>Boundary</th><th>Signal</th><th>Conf.</th></tr></thead><tbody>${top.map((r) => `<tr><td>${esc(r.user_prefix)}</td><td>${esc(r.assumed_boundary)}</td><td>${esc(r.strongest_signal)}</td><td>${pct(r.confidence)}</td></tr>`).join('')}</tbody></table>` : '<p class="cd-muted">No boundary signal yet</p>'}</div>`;
  }

  function frequency(rows) {
    const top = (rows || []).slice(0, 8);
    return `<div class="cd-card"><h3>Resonance Frequency</h3>${top.length ? `<table class="cd-table"><thead><tr><th>User</th><th>Open Time</th><th>Depth</th><th>Mode</th><th>Precision</th></tr></thead><tbody>${top.map((r) => `<tr><td>${esc(r.user_prefix)}</td><td>${esc(r.most_open_time || '-')}</td><td>${esc(r.most_open_depth || '-')}</td><td>${esc(r.most_open_mode || '-')}</td><td>${esc(r.most_resonant_trigger || '-')}</td></tr>`).join('')}</tbody></table>` : '<p class="cd-muted">No resonance profile yet</p>'}</div>`;
  }

  function relationalSignals(data) {
    const sig = data.relational_signals || {};
    const totals = sig.totals || {};
    const boundaryEvents = (sig.boundary_events || []).slice(0, 8);
    const pprBySignal = (sig.ppr_by_signal || []).slice(0, 12);
    return `<div class="cd-section"><h2>Affective Signal Layer</h2>
      <div class="cd-chart">
        ${bars(totals.valence || [], 'Valence', 'key')}
        ${bars(totals.intensity || [], 'Intensity', 'key')}
        ${bars(totals.openness || [], 'Openness', 'key')}
        ${bars(totals.ppr_hint || [], 'PPR Hint', 'key')}
        ${bars(totals.boundary_risk || [], 'Boundary Risk', 'key')}
        ${bars(totals.strategy || [], 'Strategy', 'key')}
      </div>
      <div class="cd-grid cd-section">
        <div class="cd-card"><h3>Boundary Feedback Events</h3>${boundaryEvents.length ? `<table class="cd-table"><thead><tr><th>User</th><th>Risk</th><th>Hint</th><th>Strategy</th><th>Count</th></tr></thead><tbody>${boundaryEvents.map((r) => `<tr><td>${esc(r.user_prefix)}</td><td><span class="cd-pill ${esc(r.boundary_risk)}">${esc(r.boundary_risk)}</span></td><td>${esc(r.ppr_hint)}</td><td>${esc(r.strategy)}</td><td>${r.count}</td></tr>`).join('')}</tbody></table>` : '<p class="cd-muted">No boundary feedback yet</p>'}</div>
        <div class="cd-card"><h3>PPR By Signal</h3>${pprBySignal.length ? `<table class="cd-table"><thead><tr><th>Risk</th><th>Hint</th><th>Strategy</th><th>Type</th><th>Count</th></tr></thead><tbody>${pprBySignal.map((r) => `<tr><td>${esc(r.boundary_risk)}</td><td>${esc(r.ppr_hint)}</td><td>${esc(r.strategy)}</td><td>${esc(r.event_type)}</td><td>${r.count}</td></tr>`).join('')}</tbody></table>` : '<p class="cd-muted">No linked PPR signal yet</p>'}</div>
      </div>
    </div>`;
  }

  function closedLoop(data) {
    const loop = data.closed_loop || {};
    const suppressed = loop.proactive_suppressed_users || [];
    const softened = loop.memory_softened_users || [];
    return `<div class="cd-section"><h2>Closed Loop Controls</h2><div class="cd-grid">
      <div class="cd-card"><h3>Proactive Suppression</h3>${suppressed.length ? `<table class="cd-table"><thead><tr><th>User</th><th>Reason</th></tr></thead><tbody>${suppressed.map((r) => `<tr><td>${esc(r.user_prefix)}</td><td>${esc(r.reason)}</td></tr>`).join('')}</tbody></table>` : '<p class="cd-muted">No users currently suppressed by boundary feedback</p>'}</div>
      <div class="cd-card"><h3>Memory Recall Softening</h3>${softened.length ? `<table class="cd-table"><thead><tr><th>User</th><th>Caution</th><th>Hint</th></tr></thead><tbody>${softened.map((r) => `<tr><td>${esc(r.user_prefix)}</td><td><span class="cd-pill ${esc(r.caution_level)}">${esc(r.caution_level)}</span></td><td>${esc(r.avoid_or_soften_hint || '-')}</td></tr>`).join('')}</tbody></table>` : '<p class="cd-muted">No memory recall softening active</p>'}</div>
    </div></div>`;
  }

  function executionLoop(data) {
    const loop = data.execution_loop || {};
    const deliveries = loop.delivery || [];
    const modelRuns = loop.model_runs || [];
    const actions = loop.agent_actions || [];
    return `<div class="cd-section"><h2>Execution & Provenance</h2><div class="cd-chart">
      ${bars(deliveries.map((r) => ({ key: r.status, count: r.count })), 'Delivery Receipts', 'key')}
      ${bars(modelRuns.map((r) => ({ key: `${r.context_mode}/${r.status}`, count: r.count })), 'Model Context Modes', 'key')}
      ${bars(actions.map((r) => ({ key: `${r.action}/${r.outcome}`, count: r.count })), 'Action Arbiter Outcomes', 'key')}
    </div></div>`;
  }

  function relationalState(data) {
    const rows = (data.relational_state || []).filter(Boolean).slice(0, 12);
    return `<div class="cd-section"><h2>Relational State Layer</h2>${rows.length ? `<div class="cd-grid">${rows.map((r) => {
      const caution = r.caution_level || 'normal';
      return `<div class="cd-card">
        <h3>User ${esc(String(r.user_id || '').slice(0, 8))} <span class="cd-pill ${esc(caution)}">${esc(caution)}</span></h3>
        <div class="cd-kpi">
          <div><span class="cd-small">Full</span><b>${r.ppr?.full || 0}</b></div>
          <div><span class="cd-small">Rejected</span><b>${r.ppr?.rejected || 0}</b></div>
          <div><span class="cd-small">Neutral</span><b>${r.ppr?.neutral || 0}</b></div>
          <div><span class="cd-small">Success</span><b>${pct(r.ppr_success_rate)}</b></div>
          <div><span class="cd-small">Boundary pressure</span><b>${Number(r.boundary_pressure || 0).toFixed(1)}</b></div>
        </div>
        <div class="cd-signal-row"><span class="cd-muted">Unanswered</span><span>${r.unanswered_proactive || 0} proactive message(s)</span></div>
        <div class="cd-signal-row"><span class="cd-muted">Preferred</span><span>${esc(r.preferred_ppr_hint || '-')}</span></div>
        <div class="cd-signal-row"><span class="cd-muted">Soften</span><span>${esc(r.avoid_or_soften_hint || '-')}</span></div>
        <div class="cd-small">Successful: ${esc((r.successful_hints || []).map((x) => `${x.key}:${x.count}`).join(', ') || 'none')}</div>
        <div class="cd-small">Risky: ${esc((r.risky_hints || []).map((x) => `${x.key}/${x.boundary_risk}:${x.count}`).join(', ') || 'none')}</div>
      </div>`;
    }).join('')}</div>` : '<p class="cd-muted">No relational state yet</p>'}</div>`;
  }

  function relationshipProfiles(data) {
    const rows = (data.relationship_profiles || []).filter(Boolean).slice(0, 16);
    return `<div class="cd-section"><h2>Relationship Development</h2>${rows.length ? `<div class="cd-grid">${rows.map((r) => {
      const scores = r.direction_scores || {};
      const scoreRows = Object.entries(scores).map(([key, count]) => ({ key, count }));
      return `<div class="cd-card">
        <h3>User ${esc(String(r.user_id || '').slice(0, 8))}</h3>
        <div class="cd-kpi">
          <div><span class="cd-small">Familiarity</span><b>${esc(r.familiarity_stage)}</b></div>
          <div><span class="cd-small">Depth</span><b>${r.familiarity_score || 0}/200</b></div>
          <div><span class="cd-small">Direction</span><b>${esc(r.primary_direction || 'UNDEFINED')}</b></div>
          <div><span class="cd-small">Confidence</span><b>${pct(r.direction_confidence)}</b></div>
        </div>
        ${scoreRows.map((item) => `<div class="cd-bar"><span>${esc(item.key)}</span><div class="cd-fill" style="width:${Math.max(2, Math.round(Number(item.count || 0) * 1.2))}px"></div><b>${Math.round(Number(item.count || 0))}</b></div>`).join('')}
      </div>`;
    }).join('')}</div>` : '<p class="cd-muted">No relationship profile yet</p>'}</div>`;
  }

  fetch(`/api/admin/dashboard?key=${encodeURIComponent(key)}`)
    .then((r) => r.json())
    .then((data) => {
      const mem = data.memory || {};
      const pr = data.pending_review || {};
      const research = data.ppr_research || {};
      root.innerHTML = `
        <h2>CARROT DUCK Research Console</h2>
        <div class="cd-chart">
          ${bars(mem.by_thread || [], 'Memory Threads', 'thread')}
          ${bars(mem.by_topic || [], 'Emergent Topics', 'topic_key')}
          ${bars(mem.by_confidence || [], 'Confidence', 'confidence')}
          ${bars(mem.by_status || [], 'Memory Lifecycle', 'status')}
          ${bars(pr.by_status || [], 'Pending Review Status', 'status')}
        </div>
        ${relationalSignals(data)}
        ${relationshipProfiles(data)}
        ${relationalState(data)}
        ${closedLoop(data)}
        ${executionLoop(data)}
        <div class="cd-section"><h2>PPR Research</h2><div class="cd-grid">${pprMap(research.trigger_map)}${boundary(research.boundary_probe)}${frequency(research.resonance_frequency)}</div></div>
      `;
    })
    .catch((e) => {
      root.innerHTML = `<h2>CARROT DUCK Research Console</h2><p class="cd-muted">${esc(e.message)}</p>`;
    });
})();
