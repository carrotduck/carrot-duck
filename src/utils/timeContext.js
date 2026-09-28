const SLOTS = [
  { start: 6, end: 8.99, label: '早晨', suitable: ['早安', '今天有什么计划'], avoid: ['吃晚饭了吗', '在忙吗'] },
  { start: 9, end: 11.99, label: '上午', suitable: [], avoid: ['在休息吗', '睡醒了吗'] },
  { start: 12, end: 13.5, label: '午饭时间', suitable: ['吃饭了吗'], avoid: ['在工作吗'] },
  { start: 13.5, end: 17.99, label: '下午工作时间', suitable: [], avoid: ['吃中饭了吗', '在休息吗', '睡觉了吗'] },
  { start: 18, end: 19.5, label: '下班时间', suitable: ['下班了吗', '今天怎么样'], avoid: [] },
  { start: 19.5, end: 21.99, label: '晚上', suitable: ['吃晚饭了吗'], avoid: ['吃早饭了吗'] },
  { start: 22, end: 23.99, label: '深夜', suitable: [], avoid: ['在忙吗', '出门吗'] },
  { start: 0, end: 5.99, label: '凌晨', suitable: [], avoid: ['所有闲聊'] },
];

export function getLocalTimeParts(date = new Date(), timeZone = 'Asia/Shanghai') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  const clock = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const decimalHour = hour + minute / 60;
  return { hour, minute, clock, decimalHour };
}

function matchSlot(decimalHour) {
  for (const slot of SLOTS) {
    if (decimalHour >= slot.start && decimalHour <= slot.end) return slot;
  }
  return SLOTS[SLOTS.length - 1];
}

/** Human-readable local time for prompts — avoids raw UTC ISO confusing the model. */
export function formatTimeAnchorForUser(user, date = new Date()) {
  const tz = user?.timezone || 'Asia/Shanghai';
  const { clock, decimalHour } = getLocalTimeParts(date, tz);
  const slot = matchSlot(decimalHour);
  const dateStr = new Intl.DateTimeFormat('zh-CN', {
    timeZone: tz,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(date);
  return `${dateStr} ${clock}（${tz}，${slot.label}）`;
}

export function buildTimeContextBlock(user, date = new Date()) {
  const tz = user?.timezone || 'Asia/Shanghai';
  const { clock, decimalHour } = getLocalTimeParts(date, tz);
  const slot = matchSlot(decimalHour);
  const suitable = slot.suitable.length ? slot.suitable.join('、') : '（无特别建议）';
  const avoid = slot.avoid.length ? slot.avoid.join('、') : '（无特别限制）';

  let scheduleBlock = '';
  if (user?.work_start && user?.work_end) {
    scheduleBlock = `\n${user.name} 的作息：上班时间约 ${user.work_start}–${user.work_end}（${tz}）。工作时段内避免打扰式闲聊。`;
  }

  return `现在是${slot.label}（${clock}，${tz}）
适合聊：${suitable}
不要说：${avoid}
发消息前先想想这个时间 ${user.name} 可能在做什么。${scheduleBlock}`;
}

export function isReasonableKeepaliveHour(user, date = new Date()) {
  const tz = user?.timezone || 'Asia/Shanghai';
  const { decimalHour } = getLocalTimeParts(date, tz);
  const slot = matchSlot(decimalHour);
  if (slot.label === '凌晨') return false;
  const start = user?.notify_window_start ?? 8;
  const end = user?.notify_window_end ?? 1;
  const hour = Math.floor(decimalHour);
  if (end < start) return hour >= start || hour < end;
  return hour >= start && hour < end;
}

function parseClockToDecimal(clock) {
  const [h, m] = String(clock || '').split(':').map(Number);
  if (!Number.isFinite(h)) return null;
  return h + (Number.isFinite(m) ? m / 60 : 0);
}

/** User activity state for roam probability — working / resting / sleeping */
export function getUserActivityState(user, date = new Date()) {
  const tz = user?.timezone || 'Asia/Shanghai';
  const { decimalHour } = getLocalTimeParts(date, tz);
  const slot = matchSlot(decimalHour);

  if (slot.label === '凌晨' || decimalHour >= 23 || decimalHour < 6) {
    return 'sleeping';
  }

  const workStart = parseClockToDecimal(user?.work_start);
  const workEnd = parseClockToDecimal(user?.work_end);
  if (workStart != null && workEnd != null) {
    if (workEnd >= workStart) {
      if (decimalHour >= workStart && decimalHour <= workEnd) return 'working';
    } else if (decimalHour >= workStart || decimalHour <= workEnd) {
      return 'working';
    }
  } else if (decimalHour >= 9 && decimalHour < 18) {
    return 'working';
  }

  return 'resting';
}

export function activityStateLabel(state, lang = 'zh') {
  const map = {
    zh: { working: '工作或忙碌', resting: '休息', sleeping: '可能在睡' },
    en: { working: 'likely busy', resting: 'at rest', sleeping: 'likely asleep' },
  };
  const pack = map[lang === 'en' ? 'en' : 'zh'];
  return pack[state] || pack.resting;
}
