// Shared helpers for the ClaudeTwin hook scripts. No dependencies (Node 18+).
// The connector URL and token come from the plugin's userConfig: Claude Code exports
// them as CLAUDE_PLUGIN_OPTION_*; hooks.json also passes them as arguments.

export function settings(argv = process.argv.slice(2)) {
  const url = process.env.CLAUDE_PLUGIN_OPTION_CONNECTOR_URL || argv[0] || '';
  const token = process.env.CLAUDE_PLUGIN_OPTION_ACCOUNT_TOKEN || argv[1] || '';
  // An unsubstituted placeholder means the option was never set.
  if (!url || !token || url.includes('${') || token.includes('${')) return null;
  return { base: url.trim().replace(/\/+$/, ''), token: token.trim() };
}

export async function api(s, path, init = {}) {
  const res = await fetch(s.base + path, {
    ...init,
    headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function readStdin() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

// Hooks must never break a session: swallow every error and exit 0.
export function run(main) {
  main()
    .catch(() => {})
    .finally(() => process.exit(0));
}
