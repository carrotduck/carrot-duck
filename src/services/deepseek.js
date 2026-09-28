import https from 'https';
import { DEEPSEEK_API_KEY, DEEPSEEK_MODEL } from '../config.js';
import { recordCacheUsage } from './cacheStats.js';

const NON_STREAM_TIMEOUT_MS = 45_000;
const STREAM_TIMEOUT_MS = 90_000;

function logUsage(usage, source) {
  if (!usage) return;
  recordCacheUsage(usage, source);
  if (usage.prompt_cache_hit_tokens || usage.prompt_cache_miss_tokens) {
    console.log('[deepseek-cache]', {
      source,
      hit: usage.prompt_cache_hit_tokens || 0,
      miss: usage.prompt_cache_miss_tokens || 0,
    });
  }
}

function apiError(message, { status = 0, retryable = false } = {}) {
  const error = new Error(message);
  error.status = status;
  error.retryable = retryable;
  return error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestOptions(body) {
  return {
    hostname: 'api.deepseek.com',
    path: '/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      'Content-Length': Buffer.byteLength(body),
    },
  };
}

function requestNonStream(body, source) {
  return new Promise((resolve, reject) => {
    const req = https.request(requestOptions(body), (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('aborted', () => reject(apiError('DeepSeek response aborted', { retryable: true })));
      res.on('end', () => {
        const status = res.statusCode || 0;
        let parsed;
        try {
          parsed = JSON.parse(data || '{}');
        } catch {
          return reject(apiError(`DeepSeek returned invalid JSON (${status})`, {
            status,
            retryable: status >= 500 || status === 429,
          }));
        }
        if (status < 200 || status >= 300 || parsed.error) {
          const message = parsed.error?.message || `DeepSeek HTTP ${status}`;
          return reject(apiError(message, { status, retryable: status === 429 || status >= 500 }));
        }
        const text = String(parsed.choices?.[0]?.message?.content || '').trim();
        if (!text) return reject(apiError('DeepSeek returned an empty response', { retryable: true }));
        const usage = parsed.usage || null;
        logUsage(usage, source);
        return resolve({ text, usage });
      });
    });
    req.setTimeout(NON_STREAM_TIMEOUT_MS, () => {
      req.destroy(apiError('DeepSeek request timed out', { retryable: true }));
    });
    req.on('error', (error) => reject(error.retryable == null
      ? apiError(error.message, { retryable: true })
      : error));
    req.write(body);
    req.end();
  });
}

export async function callDeepSeek(messages, {
  maxTokens = 1024,
  temperature = 0.8,
  source = 'other',
  retries = 2,
} = {}) {
  if (!DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY is not configured');
  const body = JSON.stringify({
    model: DEEPSEEK_MODEL,
    messages,
    max_tokens: maxTokens,
    temperature,
    stream: false,
  });

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await requestNonStream(body, source);
    } catch (error) {
      lastError = error;
      if (!error.retryable || attempt >= retries) throw error;
      await sleep(350 * (2 ** attempt) + Math.floor(Math.random() * 180));
    }
  }
  throw lastError;
}

export function callDeepSeekStream(messages, {
  maxTokens = 1024,
  temperature = 0.8,
  onChunk,
  onEnd,
  source = 'chat_stream',
} = {}) {
  if (!DEEPSEEK_API_KEY) {
    onEnd?.('', new Error('DEEPSEEK_API_KEY is not configured'));
    return null;
  }

  const body = JSON.stringify({
    model: DEEPSEEK_MODEL,
    messages,
    max_tokens: maxTokens,
    temperature,
    stream: true,
    stream_options: { include_usage: true },
  });
  let finished = false;
  const finish = (text, error) => {
    if (finished) return;
    finished = true;
    onEnd?.(text, error || null);
  };

  const req = https.request(requestOptions(body), (res) => {
    if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
      let errorBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { errorBody += chunk; });
      res.on('end', () => {
        let message = `DeepSeek HTTP ${res.statusCode || 0}`;
        try { message = JSON.parse(errorBody)?.error?.message || message; } catch { /* keep status */ }
        finish('', apiError(message, { status: res.statusCode || 0 }));
      });
      return;
    }

    let full = '';
    let buffer = '';
    let lastUsage = null;
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload);
          if (parsed.error) return finish(full, apiError(parsed.error.message || 'DeepSeek stream error'));
          if (parsed.usage) lastUsage = parsed.usage;
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta) {
            full += delta;
            onChunk?.(delta, full);
          }
        } catch {
          // A partial line remains buffered; isolated malformed provider lines are ignored.
        }
      }
    });
    res.on('aborted', () => finish(full, apiError('DeepSeek stream aborted')));
    res.on('error', (error) => finish(full, error));
    res.on('end', () => {
      logUsage(lastUsage, source);
      if (!full.trim()) return finish('', apiError('DeepSeek returned an empty stream'));
      finish(full, null);
    });
  });
  req.setTimeout(STREAM_TIMEOUT_MS, () => req.destroy(apiError('DeepSeek stream timed out')));
  req.on('error', (error) => finish('', error));
  req.write(body);
  req.end();
  return req;
}

export async function warmupCache(messages) {
  return callDeepSeek(messages, { maxTokens: 1, temperature: 0, source: 'warmup', retries: 0 });
}
