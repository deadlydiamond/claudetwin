// Local stdio MCP server that forwards to a ClaudeTwin connector over HTTP.
// Lets apps that only run local MCP servers (the Claude desktop app's
// claude_desktop_config.json) reach a connector on localhost, no public URL needed.
//
// Env:
//   CLAUDETWIN_URL    connector base URL, e.g. http://localhost:8787
//   CLAUDETWIN_TOKEN  this account's token (CLAUDETWIN_WORK_TOKEN or CLAUDETWIN_PERSONAL_TOKEN)
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const base = (process.env.CLAUDETWIN_URL || 'http://localhost:8787').replace(/\/+$/, '');
const token = (process.env.CLAUDETWIN_TOKEN || '').trim();
if (!token) {
  console.error('Set CLAUDETWIN_TOKEN to this account\'s ClaudeTwin token.');
  process.exit(1);
}

// The connector is stateless, so a short-lived client per request is enough and
// survives connector restarts.
async function remote(fn) {
  const client = new Client({ name: 'claudetwin-bridge', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${encodeURIComponent(token)}`)));
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

const unreachable = (err) => ({
  content: [{ type: 'text', text: `ClaudeTwin connector not reachable at ${base} (${err.message}). Is it running?` }],
  isError: true,
});

const server = new Server({ name: 'claudetwin', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, () => remote((c) => c.listTools()));
server.setRequestHandler(CallToolRequestSchema, (req) => remote((c) => c.callTool(req.params)).catch(unreachable));
await server.connect(new StdioServerTransport());
