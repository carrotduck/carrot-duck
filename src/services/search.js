import https from 'https';
import { SEARCH_API_KEY, SEARCH_API_PROVIDER } from '../config.js';
import { callDeepSeek } from './deepseek.js';

function httpsJsonRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data || '{}'));
        } catch {
          reject(new Error('Search parse error'));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function searchTavily(query, apiKey) {
  const body = JSON.stringify({
    api_key: apiKey,
    query,
    max_results: 5,
    search_depth: 'basic',
    include_answer: false,
  });
  const parsed = await httpsJsonRequest({
    hostname: 'api.tavily.com',
    path: '/search',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, body);
  return (parsed.results || []).slice(0, 5).map((r) => ({
    title: String(r.title || '').slice(0, 200),
    url: String(r.url || ''),
    snippet: String(r.content || r.snippet || '').slice(0, 300),
  })).filter((r) => r.url);
}

export async function performWebSearch(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const provider = (SEARCH_API_PROVIDER || 'none').toLowerCase();
  const apiKey = SEARCH_API_KEY || '';
  if (!apiKey || provider === 'none') return [];
  try {
    if (provider === 'tavily') return await searchTavily(q, apiKey);
    return [];
  } catch {
    return [];
  }
}

export async function summarizeExploreForDiary(topic, query, results, aiName = 'Duck') {
  if (!results?.length) return null;
  const compact = results.map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.snippet || ''}`).join('\n\n');
  const { text } = await callDeepSeek([
    {
      role: 'system',
      content: `You are ${aiName}. Write a private diary entry from web search snippets. JSON only: {"summary":"150-250 chars, factual","thought":"one short personal line under 30 chars"}.`,
    },
    { role: 'user', content: `Topic: ${topic}\nQuery: ${query}\n\nResults:\n${compact}` },
  ], { maxTokens: 400, temperature: 0.35 });
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    return {
      summary: String(o.summary || '').trim().slice(0, 400),
      thought: String(o.thought || '').trim().slice(0, 60),
    };
  } catch {
    return null;
  }
}
