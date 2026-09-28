const stats = {
  total_hit: 0,
  total_miss: 0,
  total_completion_tokens: 0,
  by_source: {},
  recent: [],
};

export function recordCacheUsage(usage, source = 'other') {
  if (!usage) return;
  const hit = Number(usage.prompt_cache_hit_tokens) || 0;
  const miss = Number(usage.prompt_cache_miss_tokens) || 0;
  const completion = Number(usage.completion_tokens) || 0;
  if (!hit && !miss && !completion) return;

  stats.total_hit += hit;
  stats.total_miss += miss;
  stats.total_completion_tokens += completion;

  if (!stats.by_source[source]) {
    stats.by_source[source] = { hit: 0, miss: 0, completion: 0, calls: 0 };
  }
  const bucket = stats.by_source[source];
  bucket.hit += hit;
  bucket.miss += miss;
  bucket.completion += completion;
  bucket.calls += 1;

  stats.recent.unshift({
    at: new Date().toISOString(),
    source,
    hit,
    miss,
    completion,
  });
  stats.recent = stats.recent.slice(0, 80);
}

export function getCacheStats() {
  const promptTotal = stats.total_hit + stats.total_miss;
  return {
    total_hit: stats.total_hit,
    total_miss: stats.total_miss,
    total_completion_tokens: stats.total_completion_tokens,
    hit_rate: promptTotal ? stats.total_hit / promptTotal : 0,
    by_source: stats.by_source,
    recent: stats.recent,
  };
}
