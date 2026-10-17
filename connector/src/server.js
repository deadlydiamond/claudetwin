// ClaudeTwin connector: a remote MCP server both Claude accounts connect to.
//
//   Connector URL (add in claude.ai → Settings → Connectors → Add custom connector):
//     https://<your-host>/mcp/<ACCOUNT_TOKEN>
//   Each account gets its own token, so the server knows who is calling.
//
// Env:
//   CLAUDETWIN_WORK_TOKEN, CLAUDETWIN_PERSONAL_TOKEN   (required, long random strings)
//   CLAUDETWIN_MODE   shared (default) | isolated
//   PORT (default 8787), DATA_DIR (default ./data)
import http from 'node:http';
import crypto from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { Store } from './store.js';

const PORT = Number(process.env.PORT || 8787);
const MODE = (process.env.CLAUDETWIN_MODE || 'shared').toLowerCase();
const store = new Store(process.env.DATA_DIR || './data');

const TOKENS = {
  work: process.env.CLAUDETWIN_WORK_TOKEN,
  personal: process.env.CLAUDETWIN_PERSONAL_TOKEN,
};
for (const [space, token] of Object.entries(TOKENS)) {
  if (!token || token.length < 24) {
    console.error(`Set CLAUDETWIN_${space.toUpperCase()}_TOKEN to a random string of 24+ characters.`);
    console.error(`Generate one with: node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`);
    process.exit(1);
  }
}

function spaceForToken(token) {
  if (!token) return null;
  const given = Buffer.from(token);
  for (const [space, expected] of Object.entries(TOKENS)) {
    const exp = Buffer.from(expected);
    if (given.length === exp.length && crypto.timingSafeEqual(given, exp)) return space;
  }
  return null;
}

// In shared mode both accounts see everything. In isolated mode each sees only
// its own space plus items explicitly saved to "shared".
const visibility = (space) => (other) => MODE !== 'isolated' || other === space || other === 'shared';

const fmt = (items) =>
  items.length
    ? items
        .map((i) =>
          i.kind === 'handoff'
            ? `[handoff · ${i.space} · ${i.at}] ${i.title}\n${i.summary}` +
              (i.nextSteps?.length ? `\nNext: ${i.nextSteps.join('; ')}` : '')
            : `[${i.role} · ${i.space} · ${i.at}${i.chatTitle ? ` · ${i.chatTitle}` : ''}] ${i.text.slice(0, 600)}`
        )
        .join('\n\n')
    : 'Nothing found.';

function buildServer(space) {
  const canSee = visibility(space);
  const server = new McpServer({ name: 'claudetwin', version: '1.0.0' });

  server.tool(
    'save_handoff',
    'Save where the current work stands so the other Claude account can continue it. ' +
      'Call this after each meaningful milestone in long work, and whenever the user says handoff, save, or twin. ' +
      'Write it for a reader with no access to this chat.',
    {
      title: z.string().min(1).max(200).describe('Short name of the task'),
      summary: z.string().min(1).max(8000).describe('What was asked, what is done, key decisions and facts'),
      next_steps: z.array(z.string().max(500)).max(20).optional().describe('Concrete next actions'),
      context: z.string().max(12000).optional().describe('Code, file paths, snippets or data the next session needs'),
      visibility: z.enum(['own', 'shared']).optional().describe('In isolated mode, "shared" makes it visible to the other account'),
    },
    async ({ title, summary, next_steps, context, visibility: vis }) => {
      const h = store.addHandoff({
        space: vis === 'shared' ? 'shared' : space,
        title,
        summary,
        nextSteps: next_steps || [],
        context: context || '',
      });
      return { content: [{ type: 'text', text: `Handoff saved (${h.space}, ${h.at}).` }] };
    }
  );

  server.tool(
    'get_handoff',
    'Load the most recent handoff, usually saved by the other Claude account. ' +
      'Call this first when the user says continue, resume, twin, or pastes a prompt mentioning ClaudeTwin.',
    {},
    async () => {
      const h = store.latestHandoff(canSee);
      if (!h) return { content: [{ type: 'text', text: 'No handoff saved yet.' }] };
      const text =
        `# ${h.title}\nSaved from: ${h.space} account at ${h.at}\n\n${h.summary}` +
        (h.nextSteps.length ? `\n\n## Next steps\n- ${h.nextSteps.join('\n- ')}` : '') +
        (h.context ? `\n\n## Context\n${h.context}` : '');
      return { content: [{ type: 'text', text }] };
    }
  );

  server.tool(
    'search_history',
    'Search past handoffs and logged messages from both Claude accounts.',
    { query: z.string().max(300), limit: z.number().int().min(1).max(30).optional() },
    async ({ query, limit }) => ({ content: [{ type: 'text', text: fmt(store.search(canSee, query, limit || 10)) }] })
  );

  server.tool(
    'list_recent',
    'List the most recent handoffs and messages across both Claude accounts.',
    { limit: z.number().int().min(1).max(50).optional() },
    async ({ limit }) => ({ content: [{ type: 'text', text: fmt(store.recent(canSee, limit || 15)) }] })
  );

  return server;
}

// ---- HTTP ------------------------------------------------------------------
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 1_000_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : undefined;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, mcp-session-id, mcp-protocol-version',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-expose-headers': 'mcp-session-id',
};

const httpServer = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    if (req.method === 'OPTIONS') return res.writeHead(204).end();

    if (url.pathname === '/health') return send(res, 200, { ok: true, mode: MODE });

    // MCP endpoint: /mcp/<token>  (stateless: fresh server per request)
    const mcp = url.pathname.match(/^\/mcp\/([^/]+)\/?$/);
    if (mcp) {
      const space = spaceForToken(decodeURIComponent(mcp[1]));
      if (!space) return send(res, 401, { error: 'unknown token' });
      if (req.method !== 'POST') {
        return send(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
      }
      const body = await readBody(req);
      const server = buildServer(space);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    // REST for the ClaudeTwin app: Authorization: Bearer <token>
    if (url.pathname.startsWith('/api/')) {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const space = spaceForToken(token);
      if (!space) return send(res, 401, { error: 'unknown token' });
      const canSee = visibility(space);

      if (url.pathname === '/api/log' && req.method === 'POST') {
        const b = (await readBody(req)) || {};
        if (!['user', 'assistant'].includes(b.role) || !b.text) return send(res, 400, { error: 'role and text required' });
        const entry = store.addLog({ space, role: b.role, text: b.text, chatUrl: b.chatUrl, chatTitle: b.chatTitle });
        return send(res, 201, { id: entry.id });
      }
      if (url.pathname === '/api/history' && req.method === 'GET') {
        const q = url.searchParams.get('q') || '';
        const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);
        return send(res, 200, { items: q ? store.search(canSee, q, limit) : store.recent(canSee, limit) });
      }
      if (url.pathname === '/api/handoff' && req.method === 'GET') {
        return send(res, 200, { handoff: store.latestHandoff(canSee) });
      }
    }

    send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: 'internal error' });
  }
});

httpServer.listen(PORT, () => {
  console.log(`ClaudeTwin connector on :${PORT} (mode: ${MODE})`);
  console.log(`  Company  connector URL: https://<host>/mcp/<CLAUDETWIN_WORK_TOKEN>`);
  console.log(`  Personal connector URL: https://<host>/mcp/<CLAUDETWIN_PERSONAL_TOKEN>`);
});
