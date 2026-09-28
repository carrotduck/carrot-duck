import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { db } from '../db.js';
import { DEEPSEEK_MODEL } from '../config.js';

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function blockEntry(name, message, cacheable = false) {
  const content = String(message?.content || '');
  return {
    name,
    role: message?.role || 'system',
    chars: content.length,
    hash: hash(content),
    cacheable,
  };
}

function retrievalRef(memory) {
  return {
    id: memory.id,
    category: memory.category,
    thread: memory.thread,
    topic_key: memory.topic_key || null,
    confidence: memory.confidence,
    source_type: memory.source_type || 'legacy',
    epistemic_mode: memory.epistemic_mode || 'inference',
    retrieval: memory.retrieval || [],
  };
}

export function startModelRun({
  userId,
  turnId,
  systemMessages = [],
  apiMessages = [],
  turnPlan,
  memories = [],
  innerMemories = [],
  neocortex = [],
  params = {},
  extraBlocks = [],
} = {}) {
  const id = uuid();
  const now = new Date().toISOString();
  const systemPayload = JSON.stringify(systemMessages.map((item) => [item.role, item.content]));
  const contextPayload = JSON.stringify(apiMessages.map((item) => [item.role, item.content]));
  const fullPayload = JSON.stringify({ system: systemMessages, context: apiMessages, params });
  const blocks = systemMessages.map((message, index) => blockEntry(
    index === 0 ? 'stable_system' : `dynamic_system_${index}`,
    message,
    index === 0,
  ));
  for (const block of extraBlocks) {
    blocks.push({
      name: String(block.name || 'extra'),
      role: String(block.role || 'system'),
      chars: Number(block.chars || 0),
      hash: String(block.hash || ''),
      cacheable: Boolean(block.cacheable),
    });
  }
  blocks.push({
    name: 'conversation_context',
    role: 'mixed',
    chars: apiMessages.reduce((sum, item) => sum + String(item.content || '').length, 0),
    hash: hash(contextPayload),
    cacheable: false,
  });

  const retrievalRefs = [...memories, ...innerMemories, ...neocortex].map(retrievalRef);
  const manifest = {
    schema: 'carrot_duck_prompt_manifest_v1',
    turn_id: turnId,
    context_mode: turnPlan?.context_mode || 'unknown',
    response_class: turnPlan?.response_class || 'unknown',
    blocks,
    retrieval_count: retrievalRefs.length,
  };
  const systemHash = hash(systemPayload);
  const contextHash = hash(contextPayload);
  const fullHash = hash(fullPayload);

  db.prepare(`
    INSERT INTO model_runs (
      id, user_id, turn_id, model, context_mode, token_budget,
      system_hash, context_hash, full_hash, block_manifest_json,
      retrieval_refs_json, params_json, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'started', ?)
  `).run(
    id,
    userId,
    turnId,
    DEEPSEEK_MODEL,
    turnPlan?.context_mode || 'unknown',
    turnPlan?.token_budget || 0,
    systemHash,
    contextHash,
    fullHash,
    JSON.stringify(manifest),
    JSON.stringify(retrievalRefs),
    JSON.stringify(params),
    now,
  );

  return { id, systemHash, contextHash, fullHash, manifest, retrievalRefs };
}

export function completeModelRun(runId, { output = '', status = 'completed' } = {}) {
  if (!runId) return false;
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE model_runs SET status = ?, output_hash = ?, completed_at = ? WHERE id = ?
  `).run(status, output ? hash(output) : null, now, runId);
  return result.changes > 0;
}

