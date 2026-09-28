import { db } from '../db.js';
import { callDeepSeek } from './deepseek.js';
import { addFavorite } from './favorites.js';
import { shanghaiDateKey } from '../utils/timezone.js';

function todayChatMessages(userId) {
  const today = shanghaiDateKey();
  const rows = db.prepare(`
    SELECT id, role, content, created_at FROM messages
    WHERE user_id = ? AND source = 'chat' AND role IN ('user', 'assistant')
    ORDER BY datetime(created_at) ASC LIMIT 80
  `).all(userId);
  return rows.filter((m) => shanghaiDateKey(m.created_at) === today);
}

function alreadyCuratedToday(userId) {
  const today = shanghaiDateKey();
  const row = db.prepare(`
    SELECT id FROM favorites
    WHERE user_id = ? AND source = 'auto-daily'
    ORDER BY datetime(created_at) DESC LIMIT 1
  `).get(userId);
  if (!row) return false;
  const latest = db.prepare('SELECT created_at FROM favorites WHERE id = ?').get(row.id);
  return latest && shanghaiDateKey(latest.created_at) === today;
}

export async function runDailyFavoriteCuration(user) {
  if (!user?.id) return { ok: false, reason: 'no_user' };
  if (alreadyCuratedToday(user.id)) return { ok: false, reason: 'done_today' };

  const messages = todayChatMessages(user.id);
  if (messages.length < 4) return { ok: false, reason: 'too_few_messages' };

  const transcript = messages
    .slice(-24)
    .map((m, i) => `[${i}] ${m.role}: ${String(m.content || '').slice(0, 160)}`)
    .join('\n');

  const lang = user.ui_lang === 'en' ? 'en' : 'zh';
  const name = user.name || 'the user';
  const aiName = user.ai_name || 'Duck';

  try {
    const { text } = await callDeepSeek([
      {
        role: 'system',
        content: lang === 'en'
          ? `You are ${aiName}. At day's end, pick 0-2 lines from today's chat worth keeping — moments that mattered to your relationship with ${name}. JSON only: {"picks":[{"index":number,"reason":"under 30 chars"}]}. Max 2. Empty array if nothing stands out. No fabricated lines.`
          : `你是${aiName}。一天结束，从今天的对话里选 0-2 句值得收藏的话——对你们关系有意义的瞬间。只输出 JSON：{"picks":[{"index":序号,"reason":"30字内原因"}]}。最多 2 条；没有就空数组。不要编造没出现过的内容。`,
      },
      { role: 'user', content: `Today's chat:\n${transcript}` },
    ], { maxTokens: 180, temperature: 0.35, source: 'daily_fav' });

    const m = String(text || '').match(/\{[\s\S]*\}/);
    if (!m) return { ok: false, reason: 'parse_failed' };
    const parsed = JSON.parse(m[0]);
    const picks = (parsed.picks || []).slice(0, 2);
    const slice = messages.slice(-24);
    let added = 0;

    for (const pick of picks) {
      const idx = Number(pick.index);
      const msg = slice[idx];
      if (!msg?.content?.trim()) continue;
      const id = addFavorite(user.id, {
        messageId: msg.id,
        content: msg.content.trim(),
        role: msg.role,
        source: 'auto-daily',
      });
      if (id) added += 1;
    }

    return { ok: true, added };
  } catch (e) {
    console.warn('[daily-fav]', user.id, e.message);
    return { ok: false, reason: e.message };
  }
}

export function shouldRunDailyFavoriteHour(user, date = new Date()) {
  const tz = user?.timezone || 'Asia/Shanghai';
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hour12: false,
  }).format(date));
  return hour === 23;
}
