import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const WORK = 'w'.repeat(32);
const PERSONAL = 'p'.repeat(32);
let proc;
let base;

async function startServer(mode) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctwin-'));
  const p = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, CLAUDETWIN_WORK_TOKEN: WORK, CLAUDETWIN_PERSONAL_TOKEN: PERSONAL, CLAUDETWIN_MODE: mode },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve) => p.stdout.on('data', (d) => d.toString().includes('connector on') && resolve()));
  return { p, base: `http://127.0.0.1:${port}` };
}

async function connect(b, token) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${b}/mcp/${token}`)));
  return client;
}
const text = (r) => r.content.map((c) => c.text).join('\n');

before(async () => ({ p: proc, base } = await startServer('shared')));
after(() => proc.kill());

test('rejects unknown token', async () => {
  const r = await fetch(`${base}/mcp/${'x'.repeat(32)}`, { method: 'POST', body: '{}' });
  assert.equal(r.status, 401);
});

test('lists the four tools', async () => {
  const c = await connect(base, WORK);
  const { tools } = await c.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['get_handoff', 'list_recent', 'save_handoff', 'search_history']);
  await c.close();
});

test('handoff saved on work is loaded on personal (shared mode)', async () => {
  const work = await connect(base, WORK);
  await work.callTool({ name: 'save_handoff', arguments: { title: 'Workflow builder', summary: 'Node palette done', next_steps: ['Wire edges'] } });
  await work.close();

  const personal = await connect(base, PERSONAL);
  const out = text(await personal.callTool({ name: 'get_handoff', arguments: {} }));
  assert.match(out, /Workflow builder/);
  assert.match(out, /Saved from: work/);
  assert.match(out, /Wire edges/);
  await personal.close();
});

test('app log + history REST + search tool', async () => {
  const r = await fetch(`${base}/api/log`, {
    method: 'POST',
    headers: { authorization: `Bearer ${PERSONAL}`, 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'user', text: 'aloo bhai reel script likho', chatTitle: 'Reels' }),
  });
  assert.equal(r.status, 201);
  const h = await (await fetch(`${base}/api/history`, { headers: { authorization: `Bearer ${WORK}` } })).json();
  assert.ok(h.items.some((i) => i.text === 'aloo bhai reel script likho'));

  const c = await connect(base, WORK);
  assert.match(text(await c.callTool({ name: 'search_history', arguments: { query: 'reel' } })), /aloo bhai/);
  await c.close();
});

test('isolated mode hides the other account unless shared', async () => {
  const { p, base: b } = await startServer('isolated');
  try {
    const work = await connect(b, WORK);
    await work.callTool({ name: 'save_handoff', arguments: { title: 'Secret company task', summary: 'internal' } });
    await work.close();

    const personal = await connect(b, PERSONAL);
    assert.match(text(await personal.callTool({ name: 'get_handoff', arguments: {} })), /No handoff/);
    await personal.close();

    const work2 = await connect(b, WORK);
    await work2.callTool({ name: 'save_handoff', arguments: { title: 'Public note', summary: 'ok to share', visibility: 'shared' } });
    await work2.close();

    const personal2 = await connect(b, PERSONAL);
    assert.match(text(await personal2.callTool({ name: 'get_handoff', arguments: {} })), /Public note/);
    await personal2.close();
  } finally {
    p.kill();
  }
});

test('whoami names the account a token belongs to', async () => {
  const who = async (token) => (await fetch(`${base}/api/whoami`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.deepEqual(await who(WORK), { space: 'work', mode: 'shared' });
  assert.equal((await who(PERSONAL)).space, 'personal');
  assert.equal((await fetch(`${base}/api/whoami`, { headers: { authorization: 'Bearer nope' } })).status, 401);
});

test('history import keeps old timestamps, skips duplicates, and reports stats', async () => {
  const auth = { authorization: `Bearer ${WORK}`, 'content-type': 'application/json' };
  const entries = [
    { role: 'user', text: 'zain notch app banao', at: '2026-09-01T10:00:00.000Z', chatUrl: 'claude-code:s1', chatTitle: 'Claude Code · zain' },
    { role: 'assistant', text: 'Notch app ready on port 8787', at: '2026-09-01T10:05:00.000Z', chatUrl: 'claude-code:s1' },
  ];
  const post = () => fetch(`${base}/api/import`, { method: 'POST', headers: auth, body: JSON.stringify({ entries }) }).then((r) => r.json());
  assert.deepEqual(await post(), { added: 2, skipped: 0 });
  assert.deepEqual(await post(), { added: 0, skipped: 2 });

  // The live hook logging the same message again does not duplicate it either.
  await fetch(`${base}/api/log`, { method: 'POST', headers: auth, body: JSON.stringify({ ...entries[0], at: undefined }) });
  const found = await (await fetch(`${base}/api/history?q=zain%20notch`, { headers: auth })).json();
  assert.equal(found.items.filter((i) => i.text === 'zain notch app banao').length, 1);
  assert.equal(found.items.find((i) => i.text === 'zain notch app banao').at, '2026-09-01T10:00:00.000Z');

  const stats = await (await fetch(`${base}/api/stats`, { headers: auth })).json();
  assert.ok(stats.messages.work >= 2);
  assert.equal(stats.oldest, '2026-09-01T10:00:00.000Z');
});

test('migrates a log kept inside claudetwin.json to log.jsonl', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctwin-'));
  const old = { role: 'user', text: 'purani baat', space: 'work', id: 'a', chatUrl: '', chatTitle: '', at: '2026-01-01T00:00:00.000Z' };
  fs.writeFileSync(path.join(dir, 'claudetwin.json'), JSON.stringify({ handoffs: [], log: [old, old] }));
  const { Store } = await import('../src/store.js');
  const s = new Store(dir);
  assert.equal(s.recent(() => true, 10).length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'claudetwin.json'), 'utf8')).log, undefined);
  assert.equal(new Store(dir).recent(() => true, 10).length, 1);
});
