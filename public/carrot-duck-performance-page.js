(() => {
  if (location.pathname === '/admin') return;

  const STYLE_ID = 'cd-performance-style';
  if (!document.getElementById(STYLE_ID)) {
    const css = document.createElement('style');
    css.id = STYLE_ID;
    css.textContent = `
      .cd-performance-nav {
        border: 0;
        border-radius: 999px;
        padding: 8px 14px;
        font: 700 14px system-ui;
        cursor: pointer;
        background: #eaf0e5;
        color: #1f261e;
      }
      .cd-performance-nav.active {
        background: #4f8f6b;
        color: #fff;
      }
      body.cd-performance-open .bottom-nav {
        align-items: center !important;
      }
      body.cd-performance-open .bottom-nav .nav-item,
      body.cd-performance-open .cd-performance-navitem {
        min-width: 0 !important;
        height: 100% !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 3px !important;
        padding: 5px 0 6px !important;
        font-size: 11px !important;
        line-height: 1.15 !important;
      }
      body.cd-performance-open .bottom-nav .nav-item > span[aria-hidden],
      body.cd-performance-open .cd-performance-icon {
        width: 22px !important;
        height: 22px !important;
        display: grid !important;
        place-items: center !important;
        font-size: 20px !important;
        line-height: 22px !important;
        margin: 0 auto !important;
        font-weight: 400 !important;
      }
      body.cd-performance-open .bottom-nav .nav-item > span:not([aria-hidden]),
      body.cd-performance-open .cd-performance-navitem span:last-child {
        display: block !important;
        font-size: 11px !important;
        line-height: 1.15 !important;
      }
      body.cd-performance-open .bottom-nav .nav-item.active::before {
        display: none !important;
        content: none !important;
      }
      .cd-performance-navitem {
        cursor: pointer;
        user-select: none;
        min-width: 0 !important;
        width: auto !important;
        flex: 1 1 0 !important;
        color: var(--muted, #8a7360);
        background: transparent !important;
        border: 0 !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        flex-direction: column !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 3px !important;
        padding: 5px 0 6px !important;
        font-size: 11px !important;
        line-height: 1.15 !important;
        display: flex !important;
      }
      body.cd-performance-open .cd-performance-navitem { color: var(--text, #3d2f24); }
      body.cd-performance-open .cd-performance-navitem::before {
        content: "";
        background: currentColor;
        border-radius: 2px;
        width: 18px;
        height: 2px;
        margin-bottom: 2px;
        display: block;
      }
      .cd-performance-navitem * {
        pointer-events: none;
      }
      .cd-performance-nav-parent {
        display: grid !important;
        grid-template-columns: repeat(5, minmax(0, 1fr)) !important;
        align-items: center !important;
      }
      .cd-performance-nav-parent > * {
        min-width: 0 !important;
        width: auto !important;
        flex: 1 1 0 !important;
      }
      .cd-performance-icon {
        display: grid;
        place-items: center;
        width: 22px;
        height: 22px;
        margin-inline: auto;
        font-size: 20px;
        line-height: 22px;
        margin-bottom: 0;
      }
      .cd-performance-fallback-tab {
        display: none !important;
        position: fixed;
        right: max(14px, env(safe-area-inset-right));
        bottom: calc(var(--cdp-nav-height, 88px) + 12px);
        transform: none;
        z-index: 2147483647;
        min-width: 56px;
        height: 42px;
        border: 1px solid var(--line, rgba(217,204,186,.86));
        border-radius: 999px;
        background: var(--panel, rgba(255,252,246,.94));
        color: var(--text, #594736);
        box-shadow: 0 8px 24px rgba(31,38,30,.12);
        font: 600 12px system-ui;
        cursor: pointer;
        align-items: center;
        justify-content: center;
        gap: 5px;
        padding: 0 12px;
      }
      .cd-performance-fallback-tab strong {
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        font-size: 20px;
        line-height: 24px;
        font-weight: 500;
      }
      .cd-performance-fallback-tab span {
        font-size: 12px;
      }
      body.cd-performance-open .cd-performance-fallback-tab { display: none; }
      .cd-performance-page {
        position: fixed;
        left: 0;
        right: 0;
        top: 0;
        bottom: var(--cdp-nav-height, 88px);
        z-index: 2147483646;
        background: var(--cdp-bg, #f7f1e6);
        overflow: hidden;
        display: none;
        font-family: inherit;
      }
      .cd-performance-page.visible { display: block; }
      .cd-performance-shell {
        min-height: 100vh;
        display: block;
        position: relative;
        padding-bottom: 230px;
      }
      .cd-performance-stage {
        position: absolute;
        inset: 0;
        right: calc(min(430px, 36vw) + clamp(18px, 4vw, 54px) + 24px);
        min-height: 100vh;
        background: var(--cdp-stage-bg, var(--cdp-bg, #f7f1e6));
      }
      .cd-performance-stage iframe {
        width: 100%;
        height: 100%;
        border: 0;
        display: block;
        pointer-events: auto;
      }
      .cd-performance-info {
        position: absolute;
        right: clamp(18px, 4vw, 54px);
        top: clamp(22px, 5vh, 58px);
        bottom: 238px;
        width: min(430px, 36vw);
        padding: 0;
        background: transparent;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: auto;
      }
      .cd-performance-info h1 {
        margin: 0 0 4px;
        font-size: 30px;
        line-height: 1.1;
        letter-spacing: 0;
        color: var(--cdp-ink, #3c3026);
      }
      .cd-performance-desc {
        display: none;
        margin: 0;
        max-width: 34em;
        color: var(--cdp-muted, #7a6754);
        font-size: 13px;
        line-height: 1.5;
      }
      .cd-performance-cards {
        display: grid;
        gap: 10px;
      }
      .cd-performance-card {
        border: 1px solid var(--cdp-line, #dfe6d8);
        border-radius: 8px;
        background: #fff;
        padding: 12px;
      }
      .cd-performance-card strong {
        display: block;
        margin-bottom: 4px;
      }
      .cd-performance-bubble {
        align-self: flex-start;
        border: 1px solid #dfe6d8;
        border-radius: 999px;
        background: var(--cdp-pill, rgba(247, 245, 241, .94));
        color: var(--cdp-muted, #6b5a49);
        padding: 7px 11px;
        font: 700 13px system-ui;
        user-select: none;
        pointer-events: none;
      }
      .cd-performance-chatlog {
        flex: 1;
        margin-top: 4px;
        min-height: 220px;
        overflow: auto;
        border: 1px solid var(--cdp-line, rgba(217, 204, 186, .88));
        border-radius: 16px;
        background: var(--cdp-panel, rgba(255, 252, 246, .82));
        padding: 12px;
        color: var(--cdp-ink, #3c3026);
        white-space: pre-wrap;
        backdrop-filter: blur(8px);
      }
      .cd-performance-call {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 0 0 auto;
        min-height: 32px;
        color: var(--cdp-ink, #3c3026);
        font: 13px system-ui;
      }
      .cd-performance-call[hidden] { display: none; }
      .cd-performance-call [data-call-label] { font-weight: 600; }
      .cd-performance-call [data-call-status] {
        flex: 1;
        min-width: 0;
        color: var(--cdp-muted, #7a6754);
      }
      .cd-performance-call time {
        flex: 0 0 auto;
        min-width: 5ch;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .cd-performance-composer {
        position: fixed;
        left: var(--cdp-shell-left, 50%);
        right: auto;
        width: var(--cdp-shell-width, min(100%, 860px));
        transform: var(--cdp-shell-transform, translateX(-50%));
        bottom: var(--cdp-nav-bottom, var(--cdp-nav-height, 88px));
        display: grid;
        grid-template-columns: 1fr auto auto;
        gap: 8px;
        align-items: end;
        padding: 8px 16px 10px;
        border-top: 1px solid var(--cdp-line, rgba(217, 204, 186, .78));
        background: var(--cdp-bar, rgba(246, 239, 226, .92));
        backdrop-filter: blur(10px);
      }
      .cd-performance-composer textarea {
        min-height: 48px;
        max-height: 86px;
        resize: none;
        border: 1px solid var(--cdp-line, rgba(205, 184, 160, .8));
        border-radius: 999px;
        padding: 13px 16px;
        font: 15px system-ui;
        background: var(--cdp-input, rgba(255, 252, 246, .94));
        color: var(--cdp-ink, #3c3026);
        outline: none;
      }
      .cd-performance-composer textarea:focus {
        border-color: var(--cdp-muted, #9a8068);
        box-shadow: 0 0 0 1px var(--cdp-muted, #9a8068) inset;
      }
      .cd-performance-composer button {
        border: 0;
        border-radius: 999px;
        min-width: 48px;
        min-height: 48px;
        padding: 0 15px;
        background: var(--cdp-input, rgba(255, 252, 246, .94));
        color: var(--cdp-muted, #7a6754);
        font: 700 14px system-ui;
        cursor: pointer;
      }
      .cd-performance-composer button.primary {
        background: transparent;
        color: #b9a48c;
        font-size: 21px;
      }
      .cd-performance-close {
        display: none !important;
        position: fixed;
        right: 16px;
        top: max(14px, env(safe-area-inset-top));
        z-index: 2147483647;
        border: 0;
        border-radius: 999px;
        width: 38px;
        height: 38px;
        background: var(--cdp-pill, rgba(247,245,241,.94));
        color: var(--cdp-muted, #7a6754);
        font: 700 20px system-ui;
        cursor: pointer;
        box-shadow: 0 8px 24px rgba(31,38,30,.12);
      }
      .cd-msg {
        display: flex;
        margin: 16px 0;
      }
      .cd-msg.user { justify-content: flex-end; }
      .cd-msg.duck { justify-content: flex-start; }
      .cd-msg.system,
      .cd-msg.action { justify-content: center; }
      .cd-msg-stack {
        display: flex;
        flex-direction: column;
        gap: 7px;
        max-width: min(78%, 430px);
      }
      .cd-msg.duck .cd-msg-stack { align-items: flex-start; }
      .cd-msg.user .cd-msg-stack { align-items: flex-end; }
      .cd-msg-name,
      .cd-msg-meta {
        color: var(--cdp-muted, #9a8068);
        font-size: 13px;
        line-height: 1;
      }
      .cd-msg-bubble {
        max-width: 100%;
        border-radius: 20px;
        padding: 13px 17px;
        background: var(--cdp-pill, rgba(247,245,241,.94));
        border: 1px solid var(--cdp-line, rgba(217,204,186,.86));
        color: var(--cdp-ink, #3c3026);
        line-height: 1.45;
        font-family: inherit;
      }
      .cd-msg.user .cd-msg-bubble {
        border-radius: 20px;
        background: var(--cdp-user, #6f4b3a);
        border-color: transparent;
        color: #fffaf3;
      }
      .cd-msg.duck .cd-msg-bubble {
        border-radius: 20px;
      }
      .cd-msg.system .cd-msg-bubble {
        max-width: min(86%, 520px);
        border: 0;
        border-radius: 14px;
        background: var(--cdp-system, rgba(118,108,96,.11));
        color: var(--cdp-muted, #7a6754);
        font-size: 13px;
        padding: 8px 12px;
      }
      .cd-msg.action .cd-msg-bubble {
        max-width: min(76%, 360px);
        border: 0;
        border-radius: 999px;
        background: var(--cdp-system, rgba(118,108,96,.11));
        color: var(--cdp-muted, #7a6754);
        font-size: 13px;
        padding: 6px 12px;
      }
      .cd-msg.duck .cd-msg-bubble,
      .cd-msg.user .cd-msg-bubble {
        font-size: 15px;
      }
      .cd-msg-time {
        display: inline-block;
        margin-right: 7px;
        color: var(--cdp-muted, #7a6754);
        font-size: 12px;
        opacity: .8;
      }
      .cd-performance-actions {
        display: none;
      }
      .cd-performance-actions button,
      .cd-performance-actions a {
        border: 0;
        border-radius: 8px;
        min-height: 36px;
        padding: 8px 12px;
        background: #eaf0e5;
        color: #1f261e;
        font: 700 13px system-ui;
        text-decoration: none;
        cursor: pointer;
      }
      .cd-performance-actions .primary {
        background: #4f8f6b;
        color: #fff;
      }
      @media (max-width: 860px) {
        .cd-performance-page {
          bottom: var(--cdp-nav-height, 88px);
          background: var(--cdp-bg, #f7f1e6);
          overflow: hidden;
        }
        .cd-performance-shell {
          min-height: calc(100dvh - var(--cdp-nav-height, 88px));
          padding-bottom: 92px;
        }
        .cd-performance-stage {
          top: 0;
          right: 0;
          height: 66dvh;
          min-height: 410px;
          max-height: 620px;
          bottom: auto;
          background: var(--cdp-stage-bg, #f8f8f4);
        }
        .cd-performance-info {
          top: min(66dvh, 620px);
          left: 0;
          right: 0;
          bottom: 88px;
          width: auto;
          gap: 0;
          padding: 0;
          background: var(--cdp-bg, #f7f1e6);
        }
        .cd-performance-info h1 {
          display: none;
        }
        .cd-performance-desc {
          display: none;
        }
        .cd-performance-bubble {
          display: none;
        }
        .cd-performance-chatlog {
          flex: 1 1 auto;
          margin: 0;
          min-height: 0;
          max-height: none;
          border: 0;
          border-radius: 0;
          padding: 8px 12px 10px;
          background: var(--cdp-bg, #f7f1e6);
          backdrop-filter: none;
        }
        .cd-performance-call { padding: 4px 12px; gap: 8px; }
        .cd-performance-page.cd-call-active .cd-performance-stage {
          height: 58dvh;
          min-height: 300px;
          max-height: 540px;
        }
        .cd-performance-page.cd-call-active .cd-performance-info {
          top: max(300px, min(58dvh, 540px));
        }
        .cd-msg { margin: 6px 0; }
        .cd-msg-bubble { padding: 8px 10px; border-radius: 15px; }
        .cd-msg.duck .cd-msg-bubble,
        .cd-msg.user .cd-msg-bubble { font-size: 13px; }
        .cd-msg.action .cd-msg-bubble { font-size: 12px; padding: 5px 10px; }
        .cd-performance-composer {
          bottom: var(--cdp-nav-bottom, var(--cdp-nav-height, 88px));
          grid-template-columns: minmax(0, 1fr) 44px 40px;
          gap: 6px;
          width: var(--cdp-shell-width, 100%);
          padding: 7px 10px;
        }
        .cd-performance-composer textarea {
          min-height: 44px;
          max-height: 68px;
          padding: 10px 13px;
          font-size: 14px;
        }
        .cd-performance-composer button {
          min-width: 40px;
          min-height: 44px;
          width: 40px;
          padding: 0;
          font-size: 13px;
        }
        .cd-performance-composer button[data-voice="1"] {
          width: 44px;
          min-width: 44px;
        }
        .cd-performance-composer button.primary { font-size: 19px; }
        .cd-performance-fallback-tab strong,
        .cd-performance-icon {
          width: 21px;
          height: 21px;
          font-size: 18px;
          line-height: 21px;
        }
        .cd-performance-fallback-tab span,
        .cd-performance-navitem span:last-child { font-size: 11px; }
      }
    `;
    document.head.appendChild(css);
  }

  const page = document.createElement('section');
  page.className = 'cd-performance-page';
  page.innerHTML = `
    <div class="cd-performance-shell">
      <button class="cd-performance-close" data-close="1" title="关闭">×</button>
      <div class="cd-performance-stage">
        <iframe title="Carrot Duck Performance" src="/live2d-demo.html?embed=1&v=20260907-rose-blush"></iframe>
      </div>
      <aside class="cd-performance-info">
        <h1 data-performance-title>演出</h1>
        <p class="cd-performance-desc" data-performance-desc>输入文字后，Duck 会回复并用当前设置的音色朗读；会跟随你的消息而聆听、思考、说话。</p>
        <div class="cd-performance-bubble" data-action-bubble>鸭子静默中</div>
        <div class="cd-performance-call" data-call hidden>
          <span data-call-label>Voice call</span>
          <span data-call-status role="status"></span>
          <time data-call-time aria-label="Call duration">--:--</time>
        </div>
        <div class="cd-performance-chatlog" data-chatlog></div>
        <div class="cd-performance-actions">
          <button class="primary" data-state="listening">聆听</button>
          <button data-state="idle">静默</button>
          <button data-speak="1">示范说话</button>
        </div>
        <div class="cd-performance-composer">
          <textarea data-input placeholder="和 Duck 说点什么..."></textarea>
          <button data-voice="1">🎙</button>
          <button class="primary" data-send="1">➤</button>
        </div>
      </aside>
    </div>
  `;
  const fallbackTab = document.createElement('button');
  fallbackTab.type = 'button';
  fallbackTab.className = 'cd-performance-fallback-tab';
  fallbackTab.innerHTML = '<strong>◌</strong><span>演出</span>';
  fallbackTab.style.display = 'none';
  fallbackTab.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showPerformance();
  });
  document.body.append(page, fallbackTab);

  const frame = page.querySelector('iframe');
  const titleEl = page.querySelector('[data-performance-title]');
  const descEl = page.querySelector('[data-performance-desc]');
  const actionBubble = page.querySelector('[data-action-bubble]');
  const chatLog = page.querySelector('[data-chatlog]');
  const input = page.querySelector('[data-input]');
  let recognition = null;
  let voiceCall = null, voiceWatch = null, voiceWait = null;
  let callStartedAt = null, callTicker = null, callState = 'off';
  const callBar = page.querySelector('[data-call]');
  const callStatus = page.querySelector('[data-call-status]');
  const callTime = page.querySelector('[data-call-time]');
  let lastActionText = '';
  let actionTicker = 0;
  let currentPerformanceState = 'idle';
  let navObserver = null;
  let navInstallTimer = 0;
  let chatPending = false;
  let performanceViewVersion = 0;
  let chatAbort = null;

  const idleActions = [
    '鸭子静默中',
  ];

  frame.addEventListener('load', () => {
    if (page.classList.contains('visible')) sendTheme();
  });

  function findBottomNavElement() {
    const candidates = [...document.querySelectorAll('.bottom-nav, nav, [class*="bottom"], [class*="nav"]')]
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 240 || rect.height < 40) return false;
        if (rect.top < window.innerHeight * 0.55) return false;
        const text = el.textContent || '';
        return /\u4e3b\u9875|Home|\u804a\u5929|Chat|\u65e5\u8bb0|Diary|\u8bbe\u7f6e|Settings/.test(text);
      })
      .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
    return candidates[0] || null;
  }

  function syncNavMetrics() {
    const nav = findBottomNavElement();
    const rect = nav?.getBoundingClientRect();
    const width = rect?.width || Math.min(window.innerWidth, 860);
    const left = rect?.left || Math.max(0, (window.innerWidth - width) / 2);
    const navTop = rect?.top || (window.innerHeight - 88);
    const navHeight = Math.max(56, window.innerHeight - navTop);
    const navBottom = Math.max(0, window.innerHeight - navTop - 1);
    page.style.setProperty('--cdp-nav-height', `${navHeight}px`);
    page.style.setProperty('--cdp-nav-bottom', `${navBottom}px`);
    page.style.setProperty('--cdp-shell-width', `${width}px`);
    page.style.setProperty('--cdp-shell-width-px', `${width}px`);
    page.style.setProperty('--cdp-shell-left', `${left}px`);
    page.style.setProperty('--cdp-shell-left-px', `${left}px`);
    page.style.setProperty('--cdp-shell-transform', 'none');
    fallbackTab.style.setProperty('--cdp-nav-height', `${navHeight}px`);
    fallbackTab.style.setProperty('--cdp-shell-width-px', `${width}px`);
    fallbackTab.style.setProperty('--cdp-shell-left-px', `${left}px`);
  }

  function applyAppPalette() {
    const bodyStyle = getComputedStyle(document.body);
    const navStyle = getComputedStyle(findBottomNavElement() || document.body);
    const allClasses = `${document.documentElement.className} ${document.body.className}`.toLowerCase();
    const storedTheme = `${localStorage.getItem('theme') || ''} ${localStorage.getItem('colorMode') || ''} ${localStorage.getItem('mode') || ''}`.toLowerCase();
    const bodyBg = bodyStyle.backgroundColor || '';
    const navBg = navStyle.backgroundColor || '';
    const ink = bodyStyle.color || '#3c3026';
    const darkByName = /dark|night|black|夜|深/.test(`${allClasses} ${storedTheme}`);
    const darkByColor = /rgb\(\s*(0|1?[0-9]|2[0-9]|3[0-9])\s*,\s*(0|1?[0-9]|2[0-9]|3[0-9])\s*,\s*(0|1?[0-9]|2[0-9]|3[0-9])\s*\)/.test(`${bodyBg} ${navBg}`);
    const dark = darkByName || darkByColor || ink.includes('255');
    const theme = dark ? {
      dark: true,
      bg: '#151515',
      stageBg: '#151515',
      stageGlow: 'rgba(255,255,255,.035)',
      ink: '#f4eee7',
      muted: '#c7bcb0',
      line: 'rgba(255,255,255,.16)',
      panel: 'rgba(28,28,28,.86)',
      input: 'rgba(34,34,34,.94)',
      bar: 'rgba(18,18,18,.94)',
      pill: 'rgba(38,38,38,.92)',
      system: 'rgba(255,255,255,.10)',
      user: '#8b6754'
    } : {
      dark: false,
      bg: '#f7f1e6',
      stageBg: '#f8f8f4',
      stageGlow: '#fff7e6',
      ink: '#3c3026',
      muted: '#7a6754',
      line: 'rgba(217,204,186,.86)',
      panel: 'rgba(255,252,246,.82)',
      input: 'rgba(255,252,246,.94)',
      bar: 'rgba(246,239,226,.92)',
      pill: 'rgba(247,245,241,.94)',
      system: 'rgba(118,108,96,.11)',
      user: '#6f4b3a'
    };
    page.dataset.theme = dark ? 'dark' : 'light';
    page.style.setProperty('--cdp-bg', theme.bg);
    page.style.setProperty('--cdp-stage-bg', theme.stageBg);
    page.style.setProperty('--cdp-ink', theme.ink);
    page.style.setProperty('--cdp-muted', theme.muted);
    page.style.setProperty('--cdp-line', theme.line);
    page.style.setProperty('--cdp-panel', theme.panel);
    page.style.setProperty('--cdp-input', theme.input);
    page.style.setProperty('--cdp-bar', theme.bar);
    page.style.setProperty('--cdp-pill', theme.pill);
    page.style.setProperty('--cdp-system', theme.system);
    page.style.setProperty('--cdp-user', theme.user);
    return theme;
  }

  function isEnglishUI() {
    return localStorage.getItem('carrotduck_lang') === 'en';
  }


  const ACTION_EN = new Map([
    ['鸭子静默中', 'Duck is idle'],
    ['鸭子轻轻点头回应', 'Duck nods in response'],
    ['鸭子偏头向你打了个招呼', 'Duck tilts their head in greeting'],
    ['鸭子列出动作库', 'Duck shows the available gestures'],
    ['鸭子正在倾听', 'Duck is listening'],
    ['鸭子正在说话', 'Duck is speaking'],
    ['鸭子正在思考', 'Duck is thinking'],
    ['鸭子轻轻笑了一下', 'Duck smiled softly'],
    ['鸭子不情不愿地笑了一下', 'Duck smiled, reluctantly'],
    ['鸭子轻轻点了点头', 'Duck nodded softly'],
    ['鸭子轻轻摇了摇头', 'Duck shook his head softly'],
    ['鸭子慢慢眨了下眼', 'Duck blinked slowly'],
    ['鸭子像是在认真思考', 'Duck seems to be thinking'],
    ['鸭子有点不好意思地偏开视线', 'Duck looked away, a little shy'],
    ['鸭子做了一个很轻的介绍动作', 'Duck made a small presenting gesture'],
    ['鸭子试着动了一下', 'Duck shifted a little'],
    ['鸭子被点到头，轻轻眨了眨眼', 'Duck was tapped on the head and blinked'],
    ['鸭子稍微低头看了你一眼', 'Duck lowered his head and looked at you'],
    ['鸭子动了动手里的灯', 'Duck moved the lamp in his hand'],
    ['鸭子顺着你的手势偏了偏头', 'Duck tilted his head with your gesture']
  ]);

  function copyText(cn, en) { return isEnglishUI() ? en : cn; }
  function actionText(text) {
    const raw = String(text || '');
    return isEnglishUI() ? (ACTION_EN.get(raw) || raw) : raw;
  }


  function refreshActionLogsCopy() {
    const english = isEnglishUI();
    chatLog?.querySelectorAll?.('.cd-msg.action .cd-msg-bubble')?.forEach((bubble) => {
      const raw = Array.from(bubble.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || '')
        .join('')
        .trim();
      if (!raw) return;
      let next = raw;
      for (const [cn, en] of ACTION_EN.entries()) {
        if (raw === cn || raw === en) {
          next = english ? en : cn;
          break;
        }
      }
      if (next === raw) return;
      Array.from(bubble.childNodes).forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) node.remove();
      });
      bubble.appendChild(document.createTextNode(next));
    });
  }

  function updateCopy() {
    const english = isEnglishUI();
    const label = english ? 'Performance' : '演出';
    page.querySelector('[data-close]').title = english ? 'Close' : '关闭';
    page.querySelector('[data-send]').setAttribute('aria-label', english ? 'Send' : '发送');
    page.querySelector('[data-voice]').setAttribute('aria-label', english ? 'Microphone' : '语音输入');
    if (titleEl) titleEl.textContent = english ? 'Performance' : '演出';
    if (descEl) {
      descEl.textContent = english
        ? 'Type a message and Duck will reply with the current voice. The character shifts through listening, thinking, speaking, and idle states.'
        : '输入文字后，Duck 会回复并用当前设置的音色朗读；会跟随你的消息而聆听、思考、说话。';
    }
    if (input) input.placeholder = english ? 'Say something to Duck...' : '和 Duck 说点什么...';
    const listenBtn = page.querySelector('[data-state="listening"]');
    const idleBtn = page.querySelector('[data-state="idle"]');
    const demoBtn = page.querySelector('[data-speak="1"]');
    if (listenBtn) listenBtn.textContent = english ? 'Listen' : '聆听';
    if (idleBtn) idleBtn.textContent = english ? 'Idle' : '静默';
    if (demoBtn) demoBtn.textContent = english ? 'Demo speech' : '示范说话';
    if (actionBubble && lastActionText) actionBubble.textContent = actionText(lastActionText);
    refreshActionLogsCopy();
    fallbackTab.querySelector('span').textContent = label;
    document.querySelectorAll('.cd-performance-nav').forEach((btn) => { btn.textContent = label; });
    document.querySelectorAll('.cd-performance-navitem').forEach((item) => {
      const targets = [...item.querySelectorAll('*')].filter((el) => /^(演出|Performance)$/.test(el.textContent?.trim() || ''));
      if (targets.length) targets[targets.length - 1].textContent = label;
    });
  }

  function actionForMessage(text) {
    const value = String(text || '').toLowerCase();
    if (/微笑|笑一下|笑一个|smile/.test(value)) {
      return { action: Math.random() > 0.45 ? '鸭子轻轻笑了一下' : '鸭子不情不愿地笑了一下', command: { state: 'idle', customAction: 'softSmile' } };
    }
    if (/点头|nod/.test(value)) return { action: '鸭子轻轻点了点头', command: { state: 'listening', customAction: 'nod' } };
    if (/摇头|shake.*head/.test(value)) return { action: '鸭子轻轻摇了摇头', command: { state: 'idle', customAction: 'shakeHead' } };
    if (/打个招呼|挥手|招手|greet|wave/.test(value)) return { action: '鸭子偏头向你打了个招呼', command: { state: 'idle', customAction: 'greet' } };
    if (/眨眼|blink/.test(value)) return { action: '鸭子慢慢眨了下眼', command: { state: 'idle', customAction: 'listening' } };
    if (/思考|think/.test(value)) return { action: '鸭子像是在认真思考', command: { state: 'listening', customAction: 'thinking' } };
    if (/害羞|脸红|不好意思|shy|blush/.test(value)) return { action: '鸭子有点不好意思地偏开视线', command: { state: 'idle', customAction: 'shy' } };
    if (/呼吸|待机|静默|idle|breathe/.test(value)) return { action: '鸭子静默中', command: { state: 'idle', customAction: 'breathe' } };
    if (/介绍|展示|introduce|present/.test(value)) return { action: '鸭子做了一个很轻的介绍动作', command: { state: 'idle', customAction: 'nod' } };
    if (/走|walk/.test(value)) return { action: '鸭子试着动了一下', command: { state: 'idle', customAction: 'breathe' } };
    if (/倾听|听我|listen/.test(value)) return { action: '鸭子正在倾听', command: { state: 'listening', customAction: 'listening' } };
    return null;
  }

  function setAction(text, state = '', options = {}) {
    if (actionBubble) actionBubble.textContent = actionText(text);
    if (state) currentPerformanceState = state;
    renderCallStatus();
    if (text && text !== lastActionText) {
      lastActionText = text;
      if (!options.silentLog) appendLog('action', actionText(text));
    }
    if (state && !options.fromLive2D) send({ state });
  }

  function currentUserId() {
    return localStorage.getItem('carrotduck_user_id') || new URLSearchParams(location.search).get('uid') || '';
  }

  function cleanPerformanceReply(text) {
    const cleaned = String(text || '')
      .replace(/\[STICKER:[^\]]+\]/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return cleaned || copyText('我在这里。', "I'm here.");
  }

  function appendLog(role, text) {
    const row = document.createElement('div');
    row.className = `cd-msg ${role}`;
    const stack = document.createElement('div');
    stack.className = 'cd-msg-stack';
    const bubble = document.createElement('div');
    bubble.className = 'cd-msg-bubble';
    const time = document.createElement('span');
    time.className = 'cd-msg-time';
    time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (role === 'system') {
      bubble.textContent = role === 'action' ? actionText(text) : text;
      row.appendChild(bubble);
    } else if (role === 'action') {
      bubble.append(time, document.createTextNode(text));
      row.appendChild(bubble);
    } else {
      const meta = document.createElement('div');
      meta.className = 'cd-msg-meta';
      meta.textContent = time.textContent;
      if (role === 'duck') {
        const name = document.createElement('div');
        name.className = 'cd-msg-name';
        name.textContent = isEnglishUI() ? 'Duck' : '小鸭';
        stack.appendChild(name);
      }
      bubble.textContent = text;
      stack.append(bubble, meta);
      row.appendChild(stack);
    }
    chatLog.appendChild(row);
    chatLog.scrollTop = chatLog.scrollHeight;
    return bubble;
  }

  function send(payload) {
    frame.contentWindow?.postMessage({ type: 'carrotduck-live2d', ...payload }, location.origin);
  }

  function sendTheme() {
    const theme = applyAppPalette();
    send({ theme });
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
    const data = event.data || {};
    if (data.type === 'carrotduck-live2d-voice-end' && voiceWait?.id === data.voiceTurnId) {
      voiceWait.finish(data.ok === true);
      return;
    }
    if (data.type !== 'carrotduck-live2d-action') return;
    if (data.state) currentPerformanceState = data.state;
    if (data.action) setAction(data.action, data.state || '', { fromLive2D: true, silentLog: !data.customAction });
  });

  async function showPerformance() {
    const viewVersion = ++performanceViewVersion;
    syncNavMetrics();
    const theme = applyAppPalette();
    updateCopy();
    document.body.classList.add('cd-performance-open');
    page.classList.add('visible');
    document.querySelectorAll('.cd-performance-nav').forEach((btn) => btn.classList.add('active'));
    setAction('鸭子静默中', 'idle');
    send({ theme, framing: 'upper', customAction: 'breathe', rehearsal: { enabled: false } });
    const accountId = currentUserId();
    try {
      const rehearsalState = await window.carrotDuckRehearsal?.refresh();
      if (rehearsalState?.active && accountId === currentUserId() && viewVersion === performanceViewVersion) {
        const response = await fetch(`/api/chat/${encodeURIComponent(accountId)}/messages`);
        if (response.ok) {
          const data = await response.json();
          if (accountId === currentUserId() && viewVersion === performanceViewVersion && !chatPending
            && data.rehearsal?.id === rehearsalState.active.id) {
            chatLog.replaceChildren();
            for (const message of data.messages) {
              const text = String(message.content || '').replace(/\[STICKER:[^\]]+\]/gi, '').trim();
              if (text) appendLog(message.role === 'assistant' ? 'duck' : message.role, text);
            }
            send({ rehearsal: { enabled: true, ears: !!data.rehearsal.plan?.rehearsal?.ears }, state: 'listening' });
          }
        }
      }
    } catch { /* The normal stage remains usable if rehearsal history cannot load. */ }
    if (viewVersion !== performanceViewVersion) return;
    clearInterval(actionTicker);
    actionTicker = setInterval(() => {
      if (!page.classList.contains('visible')) return;
      if (currentPerformanceState === 'idle' && lastActionText !== idleActions[0]) {
        setAction(idleActions[0], '', { silentLog: false });
      }
    }, 15000);
  }

  function hidePerformance() {
    stopVoiceCall();
    if (recognition) {
      recognition.onresult = recognition.onend = recognition.onerror = null;
      recognition.abort(); recognition = null;
    }
    performanceViewVersion++;
    chatAbort?.abort();
    send({ state: 'stop', rehearsal: { enabled: false } });
    page.classList.remove('visible');
    document.body.classList.remove('cd-performance-open');
    clearInterval(actionTicker);
    document.querySelectorAll('.cd-performance-nav').forEach((btn) => btn.classList.remove('active'));
  }

  function isBottomNavClick(target) {
    if (!document.body.classList.contains('cd-performance-open')) return false;
    if (target.closest('.cd-performance-page') || target.closest('.cd-performance-fallback-tab')) return false;
    const rect = target.getBoundingClientRect?.();
    if (!rect) return false;
    const navTop = window.innerHeight - 120;
    if (rect.bottom < navTop) return false;
    const text = target.textContent?.trim() || '';
    if (['主页', 'Home', '聊天', 'Chat', '日记', 'Diary', '设置', 'Settings'].includes(text)) return true;
    const parentText = target.parentElement?.textContent?.trim() || '';
    return ['主页', 'Home', '聊天', 'Chat', '日记', 'Diary', '设置', 'Settings'].some((label) => parentText.includes(label));
  }

  function makeNavButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cd-performance-nav';
    btn.textContent = isEnglishUI() ? 'Performance' : '演出';
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showPerformance();
    });
    return btn;
  }

  function makeNavClone(template) {
    const clone = template.cloneNode(false);
    clone.classList.add('cd-performance-navitem');
    clone.removeAttribute('aria-current');
    clone.removeAttribute('data-active');
    clone.textContent = '';
    const icon = document.createElement('span');
    icon.className = 'cd-performance-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '◌';
    const label = document.createElement('span');
    label.textContent = isEnglishUI() ? 'Performance' : '演出';
    clone.append(icon, label);
    clone.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showPerformance();
    });
    return clone;
  }

  function visibleText(el) {
    const text = el.textContent?.trim();
    if (!text || text.length > 24) return '';
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return '';
    return text;
  }

  function findNavItem(label) {
    const all = [...document.querySelectorAll('button, a, [role="button"], div, span')];
    const exact = all.find((el) => visibleText(el) === label);
    if (!exact) return null;
    let node = exact;
    for (let i = 0; i < 4 && node?.parentElement; i += 1) {
      const parent = node.parentElement;
      const text = parent.textContent?.trim() || '';
      const rect = parent.getBoundingClientRect();
      if (rect.width <= 180 && rect.height <= 120 && /^(⌂|⌘|☉|◎|≡|◇|□|○|◌)?\s*(主页|Home|聊天|Chat|日记|Diary|设置|Settings)\s*$/.test(text)) {
        node = parent;
      } else {
        break;
      }
    }
    return node;
  }

  function normalizeNavParent(item) {
    const parent = item?.parentElement;
    if (!parent) return;
    parent.classList.add('cd-performance-nav-parent');
  }

  function hasNativePerformanceNav() {
    return [...document.querySelectorAll('.bottom-nav .nav-item, .bottom-nav button')].some((el) => {
      const text = (el.textContent || '').replace(/[\u25c7\u2302\u2630\u25ce\u25cc\s]/g, '').trim();
      return text === '\u6f14\u51fa' || text === 'Performance';
    });
  }

  function installNav() {
    document.querySelectorAll('.cd-performance-navitem').forEach((el) => el.remove());
    document.body.classList.remove('cd-performance-has-nav');
    fallbackTab.style.display = 'none';
    syncNavMetrics();
  }

  window.addEventListener('carrotduck-performance-open', () => showPerformance());

  page.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const state = target.dataset.state;
    if (state) setAction(state === 'listening' ? '鸭子正在倾听' : '鸭子静默中', state);
    if (target.dataset.close) hidePerformance();
    if (target.dataset.speak) {
      setAction('鸭子正在说话', 'speak');
      send({ state: 'speak', text: copyText('我在这里，慢慢说。', "I'm here. Take your time.") });
    }
    if (target.dataset.send) submitPerformanceChat();
    if (target.dataset.voice) startVoiceInput();
  });

  input?.addEventListener('focus', () => { if (!chatPending && !['speaking', 'speak'].includes(currentPerformanceState)) setAction('鸭子正在倾听', 'listening'); });
  input?.addEventListener('input', () => { if (!chatPending && !['speaking', 'speak'].includes(currentPerformanceState)) setAction('鸭子正在倾听', 'listening'); });
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitPerformanceChat();
    }
  });

  function detectActionRequest(text) {
    const value = String(text || '').toLowerCase();
    if (/能.*什么.*动作|可以.*什么.*动作|动作.*有哪些|what.*action|what.*motion/.test(value)) {
      return {
        handled: true,
        reply: copyText('我可以微笑、点头、摇头，也能安静听你说。', 'I can smile, nod, shake my head, and quietly listen to you.'),
        action: '鸭子列出动作库',
        command: { state: 'idle', customAction: 'nod' },
      };
    }
    if (/倾听|听我|listen/.test(value)) return { handled: true, reply: copyText('好，我听你说。', "Okay. I'm listening."), action: '鸭子正在倾听', command: { state: 'listening', customAction: 'listening' } };
    if (/静默|安静|idle|silent/.test(value)) return { handled: true, reply: copyText('好，我安静待着。', "Okay. I'll stay quietly with you."), action: '鸭子静默中', command: { state: 'idle', customAction: 'breathe' } };
    return null;
  }

  async function submitPerformanceChat(voiceText = null, beforeSpeak = null) {
    if (typeof voiceText !== 'string') voiceText = null;
    if (voiceText === null && voiceCall?.active) stopVoiceCall();
    const text = (voiceText ?? input.value).trim();
    if (!text || chatPending) return;
    chatPending = true;
    const viewVersion = performanceViewVersion;
    const accountId = currentUserId();
    const rehearsalState = await window.carrotDuckRehearsal?.refresh();
    if (viewVersion !== performanceViewVersion || accountId !== currentUserId()) {
      chatPending = false;
      return;
    }
    if (voiceText === null) send({ state: 'stop' });
    if (voiceText === null) input.value = '';
    appendLog('user', text);
    const action = rehearsalState?.active ? null : detectActionRequest(text);
    if (action?.handled) {
      setAction(action.action, action.command?.state || '');
      send(action.command || {});
      appendLog('duck', action.reply);
      send({ state: 'speak', text: action.reply });
      chatPending = false;
      return;
    }
    const impliedAction = rehearsalState?.active ? null : actionForMessage(text);
    if (impliedAction) {
      setAction(impliedAction.action, impliedAction.command?.state || '', { silentLog: true });
      send(impliedAction.command || {});
      appendLog('action', impliedAction.action);
    }
    const userId = currentUserId();
    if (!userId) {
      appendLog('duck', copyText('还没有找到当前用户 ID。请先在胡萝卜鸭主页完成进入/恢复账号。', 'No current user ID found. Please enter or restore your account on the Carrot Duck home page first.'));
      setAction('鸭子静默中', 'idle');
      chatPending = false;
      return;
    }
    chatPending = true;
    const controller = new AbortController();
    chatAbort = controller;
    const sendButton = page.querySelector('[data-send]');
    sendButton.disabled = true;
    setAction(voiceText !== null ? '鸭子正在倾听' : '鸭子正在思考', voiceText !== null ? 'listening' : 'thinking', { silentLog: !!rehearsalState?.active });
    let replyBubble = null;
    const displayReply = (content) => {
      if (!content) return;
      replyBubble ||= appendLog('duck', content);
      replyBubble.textContent = content;
      chatLog.scrollTop = chatLog.scrollHeight;
    };
    try {
      const response = await fetch(`/api/chat/${encodeURIComponent(userId)}/chat`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          lang: isEnglishUI() ? 'en' : 'zh',
          ui_lang: isEnglishUI() ? 'en' : 'zh',
          force_chinese: !isEnglishUI(),
          response_language: isEnglishUI() ? 'en' : 'zh',
          performance_mode: true,
          no_stickers: true,
        })
      });
      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.error || `chat failed: ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalText = '';
      let expressionPlan = null;
      let rehearsalCue = null;
      let complete = false;
      const consume = (chunk) => {
        const raw = chunk.split('\n').filter((part) => part.startsWith('data:')).map((part) => part.slice(5).trimStart()).join('\n');
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data.type === 'error') throw new Error(data.error || 'chat failed');
        if (data.type === 'chunk') {
          finalText = data.content || finalText;
          displayReply(finalText.replace(/\[STICKER:[^\]]*(?:\]|$)/gi, '').trim());
        }
        if (data.type === 'done') {
          finalText = data.messages?.map((message) => message.content || '').join('\n')
            || data.message?.content || finalText;
          expressionPlan = data.expression_plan || null;
          rehearsalCue = data.rehearsal || null;
          complete = true;
        }
      };
      while (!complete) {
        const { value, done } = await reader.read();
        if (controller.signal.aborted || currentUserId() !== userId) {
          await reader.cancel();
          return;
        }
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        const chunks = buffer.split(/\r?\n\r?\n/);
        buffer = chunks.pop() || '';
        for (const chunk of chunks) {
          consume(chunk);
          if (complete) break;
        }
        if (done) {
          if (!complete && buffer.trim()) consume(buffer);
          break;
        }
      }
      if (!complete) throw new Error(copyText('回复连接中断，请重试', 'Reply interrupted. Please retry.'));
      // A final reply is ready even if the streaming connection is still open.
      reader.cancel().catch(() => {});
      if (rehearsalCue) {
        send({ rehearsal: { enabled: true, ears: !!expressionPlan?.rehearsal?.ears } });
        if (rehearsalCue.silent) {
          setAction('鸭子正在倾听', 'listening', { silentLog: true });
          send({ state: 'listening', customAction: expressionPlan?.live2d?.custom_action || 'listening', strength: expressionPlan?.live2d?.intensity,
            forceAction: ['patientNod', 'attentiveLean', 'rememberedSmile'].includes(expressionPlan?.live2d?.custom_action) });
          return;
        }
      }
      const spokenText = cleanPerformanceReply(finalText);
      displayReply(spokenText);
      if (impliedAction && expressionPlan?.boundary_mode !== 'deescalate') {
        expressionPlan = { ...expressionPlan, live2d: { ...expressionPlan?.live2d,
          custom_action: impliedAction.command.customAction } };
      }
      beforeSpeak?.();
      const playback = voiceText !== null ? waitForVoicePlayback() : null;
      send({
        state: 'speak',
        voiceTurnId: playback?.id,
        text: spokenText,
        expressionPlan,
        customAction: expressionPlan?.live2d?.custom_action || 'breathe',
        expression: expressionPlan?.live2d?.expression || '',
      });
      if (playback) await playback.done;
    } catch (error) {
      if (controller.signal.aborted || currentUserId() !== userId) return;
      appendLog(rehearsalState?.active ? 'system' : 'duck', `${copyText('演出聊天失败', 'Performance chat failed')}: ${error.message}`);
      setAction('鸭子静默中', 'idle');
      if (voiceText !== null) throw error;
    } finally {
      if (chatAbort === controller) chatAbort = null;
      chatPending = false;
      sendButton.disabled = false;
    }
  }

  function waitForVoicePlayback() {
    const id = crypto.randomUUID();
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(false), 60000);
      function finish(ok) {
        clearTimeout(timer);
        if (voiceWait?.id === id) voiceWait = null;
        if (ok) resolve(); else reject(new Error('Voice playback did not complete. Please reconnect.'));
      }
      voiceWait = { id, finish };
    });
    return { id, done };
  }

  function renderCallStatus() {
    callBar.hidden = callState === 'off';
    if (callBar.hidden) return;
    page.querySelector('[data-call-label]').textContent = copyText('语音通话', 'Voice call');
    callStatus.textContent = callState === 'connecting' ? copyText('正在连接', 'Connecting')
      : callState === 'responding' ? (currentPerformanceState === 'speaking'
        ? copyText('Duck 正在说话', 'Duck is speaking') : copyText('正在准备回复', 'Preparing reply'))
      : copyText('正在聆听', 'Listening');
    const seconds = callStartedAt === null ? null : Math.floor((performance.now() - callStartedAt) / 1000);
    callTime.textContent = seconds === null ? '--:--'
      : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    callTime.setAttribute('aria-label', copyText('通话时长', 'Call duration'));
  }

  function updateCallState(state) {
    callState = state;
    page.classList.toggle('cd-call-active', state !== 'off');
    if (state === 'off') {
      clearInterval(callTicker); callTicker = null; callStartedAt = null;
    } else if (state === 'listening' && callStartedAt === null) {
      // Start only after microphone access succeeds; reconnects keep the same call clock.
      callStartedAt = performance.now();
      callTicker = setInterval(renderCallStatus, 1000);
    }
    renderCallStatus();
  }

  function stopVoiceCall() {
    clearInterval(voiceWatch); voiceWatch = null;
    const wasActive = !!voiceCall;
    voiceCall?.stop();
    voiceCall = null;
    updateCallState('off');
    if (wasActive || voiceWait) {
      chatAbort?.abort();
      voiceWait?.finish(true);
      send({ state: 'stop' });
    }
  }

  async function startVoiceInput() {
    if (voiceCall?.active) { stopVoiceCall(); return; }
    if (chatPending) return;
    const owner = currentUserId(), version = performanceViewVersion;
    const rehearsal = await window.carrotDuckRehearsal?.refresh(true);
    if (owner !== currentUserId() || version !== performanceViewVersion || !page.classList.contains('visible')) return;
    if (rehearsal?.active && window.CarrotDuckRehearsalCall) {
      const take = rehearsal.active.id;
      const button = page.querySelector('[data-voice]');
      voiceCall = window.CarrotDuckRehearsalCall.create({
        Recognition: window.SpeechRecognition || window.webkitSpeechRecognition,
        isCurrent: () => {
          const current = window.carrotDuckRehearsal?.current();
          return currentUserId() === owner && performanceViewVersion === version && !document.hidden
            && current?.active?.id === take && !current.active.paused;
        },
        deliver: (text, beforeSpeak) => submitPerformanceChat(text, beforeSpeak),
        onInterim: text => { input.value = text; },
        onState: state => {
          updateCallState(state);
          const active = state !== 'off';
          button.textContent = active ? '\u25a0' : '\ud83c\udf99';
          button.style.color = active ? '#b3261e' : '';
          button.setAttribute('aria-pressed', String(active));
          button.setAttribute('aria-label', active ? 'End voice call' : 'Microphone');
          button.title = active ? 'End voice call' : 'Microphone';
          if (state === 'listening') setAction('鸭子正在倾听', 'listening', { silentLog: true });
        },
        onError: message => { stopVoiceCall(); appendLog('system', message); },
      });
      voiceCall.start();
      if (voiceCall?.active) {
        const session = voiceCall;
        send({ state: 'listening', customAction: 'attentiveLean', strength: 1 });
        voiceWatch = setInterval(async () => {
          const current = await window.carrotDuckRehearsal?.refresh(true);
          if (voiceCall !== session) return;
          if (currentUserId() !== owner || current?.active?.id !== take || current?.active?.paused) stopVoiceCall();
        }, 3000);
      }
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      appendLog('duck', copyText('这个浏览器暂时不支持网页语音识别，可以先用文字输入。', 'This browser does not support web speech recognition yet. You can type instead.'));
      return;
    }
    recognition?.abort?.();
    recognition = new SpeechRecognition();
    recognition.lang = isEnglishUI() ? 'en-US' : 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = false;
    setAction('鸭子正在倾听', 'listening');
    recognition.onresult = (event) => {
      let text = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        text += event.results[i][0].transcript;
      }
      input.value = text;
    };
    recognition.onend = () => {
      if (input.value.trim()) submitPerformanceChat();
      else setAction('鸭子静默中', 'idle');
    };
    recognition.onerror = () => setAction('鸭子静默中', 'idle');
    recognition.start();
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden) stopVoiceCall(); });
  window.addEventListener('pagehide', stopVoiceCall);
  window.addEventListener('storage', event => { if (event.key === 'carrotduck_user_id') stopVoiceCall(); });

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (isBottomNavClick(target)) {
      hidePerformance();
      return;
    }
    if (target.closest('.cd-performance-page') || target.closest('.cd-performance-nav')) return;
    const text = target.textContent?.trim();
    if (['主页', 'Home', '聊天', 'Chat', '日记', 'Diary', '设置', 'Settings'].includes(text)) hidePerformance();
  }, true);

  window.addEventListener('resize', syncNavMetrics, { passive: true });
  window.addEventListener('carrotduck-lang', updateCopy);
  window.addEventListener('orientationchange', syncNavMetrics, { passive: true });
  setTimeout(installNav, 300);
})();
