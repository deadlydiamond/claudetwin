// UserPromptSubmit: log the prompt. Stop: log Claude's last reply.
// Both go to the connector so either account can search them later. Prints nothing.
import fs from 'node:fs';
import path from 'node:path';
import { settings, api, readStdin, run } from './twin.mjs';

// Last assistant text in the session transcript (JSONL).
function lastReply(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return '';
  const lines = fs.readFileSync(transcriptPath, 'utf8').trimEnd().split('\n');
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 200; i--) {
    let row;
    try {
      row = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (row.type === 'user' && !row.toolUseResult && typeof row.message?.content === 'string') break; // past this turn
    if (row.type !== 'assistant') continue;
    const text = (row.message?.content || [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n')
      .trim();
    if (text) return text;
  }
  return '';
}

run(async () => {
  const s = settings(process.argv.slice(3));
  if (!s) return;
  const kind = process.argv[2]; // "prompt" | "reply"
  const input = await readStdin();
  const text = kind === 'prompt' ? (input.prompt || '').trim() : lastReply(input.transcript_path);
  if (!text) return;
  const project = input.cwd ? path.basename(input.cwd) : '';
  await api(s, '/api/log', {
    method: 'POST',
    body: JSON.stringify({
      role: kind === 'prompt' ? 'user' : 'assistant',
      text,
      chatUrl: input.session_id ? `claude-code:${input.session_id}` : '',
      chatTitle: input.session_title || (project ? `Claude Code · ${project}` : 'Claude Code'),
    }),
  });
});
