// The stdio bridge exposes the connector's tools and forwards calls under the bridge's token.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const WORK = 'w'.repeat(32);
const PERSONAL = 'p'.repeat(32);
const PORT = 8797;
const root = path.resolve(import.meta.dirname, '..');

async function bridge(token, url = `http://localhost:${PORT}`) {
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, 'src/bridge.js')],
      env: { ...process.env, CLAUDETWIN_URL: url, CLAUDETWIN_TOKEN: token },
    })
  );
  return client;
}

const text = (r) => r.content.map((c) => c.text).join('');

test('bridge forwards tools to the connector', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twin-bridge-'));
  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, CLAUDETWIN_WORK_TOKEN: WORK, CLAUDETWIN_PERSONAL_TOKEN: PERSONAL },
    stdio: 'ignore',
  });
  t.after(() => {
    server.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  await new Promise((r) => setTimeout(r, 700));

  const work = await bridge(WORK);
  const { tools } = await work.listTools();
  assert.deepEqual(tools.map((x) => x.name).sort(), ['get_handoff', 'list_recent', 'save_handoff', 'search_history']);
  await work.callTool({ name: 'save_handoff', arguments: { title: 'Desktop task', summary: 'Saved from the desktop app' } });
  await work.close();

  const personal = await bridge(PERSONAL);
  const got = text(await personal.callTool({ name: 'get_handoff', arguments: {} }));
  assert.match(got, /Desktop task/);
  assert.match(got, /Saved from: work account/);
  await personal.close();
});

test('bridge reports a stopped connector instead of crashing', async () => {
  const client = await bridge(WORK, 'http://localhost:1');
  const r = await client.callTool({ name: 'get_handoff', arguments: {} }).catch((e) => ({ thrown: e }));
  assert.ok(r.thrown || r.isError, 'call fails cleanly');
  await client.close();
});
