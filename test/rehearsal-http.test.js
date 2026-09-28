import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

test('authenticated original chat and diary routes isolate rehearsal data', { timeout: 30000 }, async t => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'duck-rehearsal-http-'));
  for (const key of ['DEEPSEEK_API_KEY','ELEVENLABS_API_KEY','ALIYUN_API_KEY','DASHSCOPE_API_KEY','EMBEDDING_API_KEY','SEARCH_API_KEY']) process.env[key] = '';
  const { default: express } = await import('express');
  const { db } = await import('../src/db.js');
  const { rehearsal } = await import('../src/services/rehearsal.js');
  const { issueCredentials, requireUserSession } = await import('../src/middleware/security.js');
  const { default: chat } = await import('../src/routes/chat.js');
  const { default: data } = await import('../src/routes/data.js');
  const app = express(); app.use(express.json(), requireUserSession);
  app.use('/api/chat', chat); app.use('/api/data', data);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const demo = randomUUID(), other = randomUUID();
  for (const id of [demo, other]) db.prepare('INSERT INTO users(id,name) VALUES(?,?)').run(id, 'HTTP fixture');
  const demoToken = issueCredentials(demo).session_token, otherToken = issueCredentials(other).session_token;
  const request = (url, token = demoToken, body, extra = {}) => fetch(base + url, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra }, body: body ? JSON.stringify(body) : undefined,
  });
  const control = `/api/chat/${demo}/rehearsal`;
  assert.equal((await request(control, '')).status, 401);
  assert.equal((await request(control)).status, 403);
  rehearsal.enroll(demo, true);
  assert.equal((await request(control, otherToken)).status, 403);
  // A forged body ID must not bypass the route's ownership check.
  assert.equal((await request(control, otherToken, { user_id: other, command: 'start', scene: 'presentation' })).status, 403);
  assert.equal((await request(`/api/chat/${other}/voice-call-end`, demoToken, { user_id: demo, content: 'must not be saved' })).status, 403);
  assert.equal((await request(`/api/data/${demo}/ppr/mark/missing`, otherToken, { user_id: other })).status, 403);
  assert.equal((await request(control, demoToken, { user_id: other, command: 'start', scene: 'presentation' })).status, 403);
  let response = await request(control, demoToken, { command: 'start', scene: 'presentation' });
  assert.equal(response.status, 200);
  let state = await response.json();
  const diary = await (await request(`/api/data/${demo}/diary`)).json();
  assert.equal(diary.diary[0].source_type, 'rehearsal');
  assert.match(diary.diary[0].content, /pause for a moment/);
  assert.equal((await request(`/api/chat/${demo}/chat`, demoToken, { message: '明天汇报' })).status, 409);
  const headers = { 'X-Duck-Rehearsal-Take': state.active.id, 'X-Duck-Rehearsal-Revision': '0', 'X-Duck-Rehearsal-Request': randomUUID() };
  response = await request(`/api/chat/${demo}/chat`, demoToken, { message: '明天汇报' }, headers);
  assert.equal(response.status, 200);
  const text = await response.text(); assert.match(text, /"type":"done"/); assert.match(text, /try a little/);
  const duplicate = await request(`/api/chat/${demo}/chat`, demoToken, { message: '明天汇报' }, headers);
  assert.equal(await duplicate.text(), text);
  for (const table of ['messages','memory_entries','ppr_events','relational_turn_signals','model_runs','delivery_commands']) {
    assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id=?`).get(demo).n, 0, table);
  }
  const history = await (await request(`/api/chat/${demo}/messages`)).json(); assert.equal(history.messages.length, 2);
  assert.equal((await request(`/api/chat/${other}/messages`)).status, 403);
  const otherHistory = await (await request(`/api/chat/${other}/messages`, otherToken)).json(); assert.equal(otherHistory.messages.length, 0);
  state = await (await request(control)).json();
  assert.equal((await request(control, demoToken, { command: 'stop', take_id: state.active.id, revision: state.active.revision })).status, 200);
  assert.equal((await (await request(`/api/chat/${demo}/messages`)).json()).messages.length, 0);
  rehearsal.enroll(demo, false);
  assert.equal((await request(control)).status, 403);
});
