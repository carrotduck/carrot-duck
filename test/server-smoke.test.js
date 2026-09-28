import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth(baseUrl, child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode != null) throw new Error(`server exited early with ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await sleep(100);
  }
  throw new Error('server health check timed out');
}

test('HTTP account migration, authorization, recovery, and mismatch protection', { timeout: 20_000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'carrot-duck-http-'));
  const port = 39000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      DEEPSEEK_API_KEY: '',
      ELEVENLABS_API_KEY: '',
      ALIYUN_API_KEY: '',
      DASHSCOPE_API_KEY: '',
      EMBEDDING_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });

  try {
    await waitForHealth(baseUrl, child);
    const create = async (name) => {
      const response = await fetch(`${baseUrl}/api/users/onboarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, keywords: { warmth: 'warm' }, ai_name: 'Duck' }),
      });
      const raw = await response.text();
      assert.equal(response.status, 200, raw);
      return JSON.parse(raw);
    };
    const first = await create('First');
    const second = await create('Second');
    assert.ok(first.session_token);
    assert.ok(first.recovery_key.startsWith(`${first.user.id}.`));

    const noAuth = await fetch(`${baseUrl}/api/chat/${first.user.id}/messages`);
    assert.equal(noAuth.status, 401);

    const authorized = await fetch(`${baseUrl}/api/chat/${first.user.id}/messages`, {
      headers: { Authorization: `Bearer ${first.session_token}` },
    });
    assert.equal(authorized.status, 200);
    assert.ok(Array.isArray((await authorized.json()).messages));

    const mismatch = await fetch(`${baseUrl}/api/chat/${second.user.id}/messages`, {
      headers: { Authorization: `Bearer ${first.session_token}` },
    });
    assert.equal(mismatch.status, 403);

    const chat = await fetch(`${baseUrl}/api/chat/${first.user.id}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${first.session_token}`,
      },
      body: JSON.stringify({ message: '你好，测试一轮聊天接口' }),
    });
    const chatBody = await chat.text();
    assert.equal(chat.status, 200, chatBody);
    assert.match(chatBody, /"type":"error"/);
    assert.match(chatBody, /DEEPSEEK_API_KEY is not configured/);

    const weakRecovery = await fetch(`${baseUrl}/api/users/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: first.user.id }),
    });
    assert.equal(weakRecovery.status, 401);

    const recovery = await fetch(`${baseUrl}/api/users/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: first.recovery_key }),
    });
    assert.equal(recovery.status, 200);
    assert.ok((await recovery.json()).session_token);
  } catch (error) {
    error.message = `${error.message}\nserver logs:\n${logs}`;
    throw error;
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      sleep(2000),
    ]);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
