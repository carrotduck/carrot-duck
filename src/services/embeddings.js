import crypto from 'crypto';
import https from 'https';
import {
  EMBEDDING_API_KEY,
  EMBEDDING_BASE_URL,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
} from '../config.js';

const cache = new Map();
const CACHE_TTL_MS = 10 * 60_000;

function cacheKey(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

export function embeddingsConfigured() {
  return Boolean(EMBEDDING_API_KEY && EMBEDDING_BASE_URL);
}

export function embedTexts(inputs) {
  if (!embeddingsConfigured()) return Promise.reject(new Error('Embedding API is not configured'));
  const values = (Array.isArray(inputs) ? inputs : [inputs])
    .map((value) => String(value || '').trim().slice(0, 8000))
    .filter(Boolean)
    .slice(0, 10);
  if (!values.length) return Promise.resolve([]);

  const body = JSON.stringify({
    model: EMBEDDING_MODEL,
    input: values,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  const endpoint = new URL(EMBEDDING_BASE_URL);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: endpoint.hostname,
      port: endpoint.port || 443,
      path: `${endpoint.pathname}${endpoint.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${EMBEDDING_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('aborted', () => reject(new Error('Embedding response aborted')));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data || '{}'); } catch { return reject(new Error('Embedding API returned invalid JSON')); }
        if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300 || parsed.error) {
          return reject(new Error(parsed.error?.message || `Embedding HTTP ${res.statusCode || 0}`));
        }
        const vectors = [...(parsed.data || [])]
          .sort((a, b) => a.index - b.index)
          .map((item) => item.embedding)
          .filter((vector) => Array.isArray(vector) && vector.length === EMBEDDING_DIMENSIONS);
        if (vectors.length !== values.length) return reject(new Error('Embedding API returned incomplete vectors'));
        return resolve(vectors);
      });
    });
    req.setTimeout(12_000, () => req.destroy(new Error('Embedding request timed out')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export async function embedQuery(text) {
  const key = cacheKey(text);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.vector;
  const [vector] = await embedTexts([text]);
  cache.set(key, { vector, expiresAt: Date.now() + CACHE_TTL_MS });
  if (cache.size > 100) {
    for (const [entryKey, entry] of cache) {
      if (entry.expiresAt <= Date.now()) cache.delete(entryKey);
    }
  }
  return vector;
}

