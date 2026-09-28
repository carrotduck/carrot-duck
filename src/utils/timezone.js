export function shanghaiDateKey(date = new Date()) {
  return userDateKey(date, 'Asia/Shanghai');
}

export function userDateKey(date = new Date(), timeZone = 'Asia/Shanghai') {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function isShanghaiToday(iso) {
  if (!iso) return false;
  return shanghaiDateKey(new Date(iso)) === shanghaiDateKey();
}

export function formatShanghaiTime(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function isWithinShanghaiDays(iso, days) {
  if (!iso) return false;
  const start = new Date(iso).getTime();
  const cutoff = Date.now() - days * 86400000;
  return start >= cutoff;
}

/** Roaming feed window: from last 12:00 (Shanghai) until next 12:00 — same as 喻拾. */
export function getRoamingWindowStart(timeZone = 'Asia/Shanghai') {
  const now = new Date();
  const dateKey = userDateKey(now, timeZone);
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false }).format(now));
  if (hour >= 12) {
    return new Date(`${dateKey}T04:00:00.000Z`);
  }
  const prev = new Date(now.getTime() - 86400000);
  const prevKey = userDateKey(prev, timeZone);
  return new Date(`${prevKey}T04:00:00.000Z`);
}

export function isInRoamingWindow(iso, timeZone = 'Asia/Shanghai') {
  if (!iso) return false;
  return new Date(iso).getTime() >= getRoamingWindowStart(timeZone).getTime();
}
