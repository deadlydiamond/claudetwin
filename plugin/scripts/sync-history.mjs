// Imports a Claude Code profile's past sessions into the ClaudeTwin connector, so the
// shared memory holds everything, not only what the hooks logged since install.
//
//   node sync-history.mjs <connector_url> <token> [config_dir] [--dry-run]
//
// config_dir defaults to $CLAUDE_CONFIG_DIR or ~/.claude. Each session transcript
// becomes its prompts and Claude's final reply per turn (as the live hooks log them).
// A state file in config_dir remembers which transcripts were already sent, so a
// re-run only reads new or changed ones. Progress goes to stdout as one JSON per line:
//   {"phase":"scan","total":N}  {"phase":"sync","done":i,"total":N,"added":a}  {"phase":"done",...}
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
const dryRun = process.argv.includes('--dry-run');
const [url, token, dirArg] = args;
const configDir = dirArg || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const projectsDir = path.join(configDir, 'projects');
const stateFile = path.join(configDir, 'claudetwin-sync.json');
const BATCH = 400;

const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');

// Text the person typed, not tool results, slash-command echoes or injected context.
function promptText(row) {
  if (row.isMeta || row.isSidechain || row.toolUseResult) return '';
  const c = row.message?.content;
  const text =
    typeof c === 'string'
      ? c
      : Array.isArray(c) && !c.some((b) => b.type === 'tool_result')
        ? c.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
        : '';
  const t = text.trim();
  if (!t || /^<(command-|local-command|system-reminder|scheduled-task|task-notification|side-sessions-event)/.test(t)) return '';
  return t;
}

const replyText = (row) =>
  (Array.isArray(row.message?.content) ? row.message.content : [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

// One transcript → its turns: each prompt, then the last text Claude wrote before the next prompt.
async function readSession(file) {
  const out = [];
  let sessionId = path.basename(file, '.jsonl');
  let project = '';
  let reply = null;
  const flush = () => {
    if (reply) out.push(reply);
    reply = null;
  };
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.sessionId) sessionId = row.sessionId;
    if (row.cwd && !project) project = path.basename(row.cwd);
    if (row.type === 'user') {
      const text = promptText(row);
      if (!text) continue;
      flush();
      out.push({ role: 'user', text, at: row.timestamp });
    } else if (row.type === 'assistant' && !row.isSidechain) {
      const text = replyText(row);
      if (text) reply = { role: 'assistant', text, at: row.timestamp };
    }
  }
  flush();
  const chatUrl = `claude-code:${sessionId}`;
  const chatTitle = project ? `Claude Code · ${project}` : 'Claude Code';
  return out.filter((m) => m.at).map((m) => ({ ...m, chatUrl, chatTitle }));
}

// Top-level session transcripts only; subagent transcripts live in nested folders.
function listTranscripts() {
  const files = [];
  let projects = [];
  try {
    projects = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return files;
  }
  for (const p of projects) {
    const dir = path.join(projectsDir, p.name);
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
      const full = path.join(dir, f.name);
      const st = fs.statSync(full);
      files.push({ file: full, key: `${st.size}:${Math.floor(st.mtimeMs)}`, size: st.size });
    }
  }
  return files;
}

async function post(entries) {
  if (dryRun) return { added: entries.length };
  const res = await fetch(url.replace(/\/+$/, '') + '/api/import', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ entries }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(res.status === 401 ? 'token rejected' : `HTTP ${res.status}`);
  return res.json();
}

async function main() {
  if (!dryRun && (!url || !token)) throw new Error('usage: sync-history.mjs <connector_url> <token> [config_dir]');
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    /* first run */
  }
  const all = listTranscripts();
  const todo = all.filter((t) => state[t.file] !== t.key);
  emit({ phase: 'scan', total: todo.length, sessions: all.length });

  let added = 0;
  let messages = 0;
  let pending = [];
  let pendingFiles = [];
  const send = async () => {
    for (let i = 0; i < pending.length; i += BATCH) added += (await post(pending.slice(i, i + BATCH))).added || 0;
    for (const t of pendingFiles) state[t.file] = t.key;
    if (!dryRun) fs.writeFileSync(stateFile, JSON.stringify(state));
    pending = [];
    pendingFiles = [];
  };
  for (let i = 0; i < todo.length; i++) {
    try {
      const msgs = await readSession(todo[i].file);
      messages += msgs.length;
      pending.push(...msgs);
    } catch {
      /* unreadable transcript: skip it */
    }
    pendingFiles.push(todo[i]);
    if (pending.length >= BATCH || i === todo.length - 1) await send();
    if (i % 10 === 0 || i === todo.length - 1) emit({ phase: 'sync', done: i + 1, total: todo.length, added });
  }
  emit({ phase: 'done', total: todo.length, sessions: all.length, messages, added });
}

main().catch((err) => {
  emit({ phase: 'error', message: err.message });
  process.exit(1);
});
