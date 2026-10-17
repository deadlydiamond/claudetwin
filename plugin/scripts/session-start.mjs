// SessionStart: give Claude the shared context from both accounts before the first prompt.
import { settings, api, run } from './twin.mjs';

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

run(async () => {
  const s = settings();
  if (!s) return;
  const [{ handoff }, { items }] = await Promise.all([api(s, '/api/handoff'), api(s, '/api/history?limit=12')]);

  const lines = ['# ClaudeTwin shared memory', 'Context shared between the Company and Personal Claude accounts.'];
  if (handoff) {
    lines.push(
      '',
      `## Latest handoff (${handoff.space}, ${handoff.at})`,
      `**${handoff.title}**`,
      clip(handoff.summary, 2500),
      ...(handoff.nextSteps?.length ? ['Next steps:', ...handoff.nextSteps.map((n) => `- ${n}`)] : [])
    );
  }
  const recent = items.filter((i) => i.kind !== 'handoff').slice(0, 8);
  if (recent.length) {
    lines.push('', '## Recent activity (newest first)');
    for (const i of recent) {
      const where = i.chatTitle ? ` · ${i.chatTitle}` : '';
      lines.push(`- [${i.space} · ${i.role}${where}] ${clip(i.text.replace(/\s+/g, ' '), 200)}`);
    }
  }
  if (!handoff && !recent.length) lines.push('', 'Nothing saved yet.');
  lines.push(
    '',
    'If the user continues earlier work, use this context (and claudetwin search_history for more). ' +
      'After a meaningful milestone, or when the user says handoff/save/twin, call claudetwin save_handoff ' +
      'so the other account can pick it up.'
  );

  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } })
  );
});
