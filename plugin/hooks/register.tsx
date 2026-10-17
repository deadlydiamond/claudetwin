// ClaudeTwin panel (/twin): both Claude accounts' sign-in status with a Log in
// button, the shared memory's health, the latest handoff with Continue / Save,
// and search across both accounts' history.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TwinAccount, TwinItem, TwinProfile, TwinView } from '../types'

const PANE = 'claudetwin'
const ACCOUNTS: TwinAccount[] = ['work', 'personal']
const LABEL: Record<string, string> = { work: 'Company', personal: 'Personal', shared: 'Shared' }
// Each account's Claude Code profile: claude-work is the default config, claude-personal its own.
const PROFILE_DIR: Record<TwinAccount, string | undefined> = { work: undefined, personal: '.claude-personal' }
const COMMAND: Record<TwinAccount, string> = { work: 'claude-work', personal: 'claude-personal' }

const CONTINUE_PROMPT =
  'Continue the latest ClaudeTwin handoff: load it with claudetwin get_handoff (and list_recent if useful), then carry on with the next steps.'
const SAVE_PROMPT =
  'Save a ClaudeTwin handoff now with claudetwin save_handoff: what was asked, what is done, key decisions, and concrete next steps, written for someone with no access to this chat.'

const view = atom({ plugin: 'claudetwin', key: 'view' } as const, {
  profiles: { work: { isLoggedIn: false }, personal: { isLoggedIn: false } },
  connector: 'loading',
  items: [],
  query: '',
} as TwinView)

// Plugin options, set again on every load of the module.
let settings: { connector_url?: unknown; account_token?: unknown; env_file?: unknown } = {}

function ago(iso?: string): string {
  if (!iso) return 'no activity yet'
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function oneLine(text = '', n = 140): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

function plan(type?: string): string | undefined {
  if (!type) return undefined
  return type.replace(/^claude_/, '').replace(/_/g, ' ')
}

async function home($: EngineInterface): Promise<string> {
  return (await $.env.get('HOME')) || ''
}

// Sign-in status from each profile's own config file (the email and plan its login recorded).
async function readProfile($: EngineInterface, account: TwinAccount): Promise<TwinProfile> {
  const dir = PROFILE_DIR[account]
  const file = dir ? `${await home($)}/${dir}/.claude.json` : `${await home($)}/.claude.json`
  try {
    const config = JSON.parse(String(await $.fs.read(file)))
    const oauth = config?.oauthAccount
    if (!oauth?.emailAddress) return { isLoggedIn: false }
    return { isLoggedIn: true, email: oauth.emailAddress, plan: plan(oauth.organizationType) }
  } catch {
    return { isLoggedIn: false }
  }
}

type Conn = { base: string; token: string }

// The plugin's own options first; else the connector's .env, picking this profile's token.
async function connection($: EngineInterface): Promise<Conn | { problem: string }> {
  const url = String(settings.connector_url || '').replace(/\/+$/, '')
  const token = String(settings.account_token || '')
  if (url && token) return { base: url, token }

  const file = String(settings.env_file || '~/Projects/claudetwin/connector/.env').replace(/^~(?=\/)/, await home($))
  try {
    const env = Object.fromEntries(
      String(await $.fs.read(file))
        .split('\n')
        .filter(l => /^[A-Z_]+=/.test(l))
        .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
    )
    const isPersonal = /personal/i.test((await $.env.get('CLAUDE_CONFIG_DIR')) || '')
    const fromEnv = env[isPersonal ? 'CLAUDETWIN_PERSONAL_TOKEN' : 'CLAUDETWIN_WORK_TOKEN']
    if (!fromEnv) return { problem: `No token found. Set the plugin's connector URL and account token.` }
    return { base: url || `http://localhost:${env.PORT || 8787}`, token: fromEnv }
  } catch {
    return { problem: `Connector not set up. Set the plugin's connector URL and account token.` }
  }
}

async function api($: EngineInterface, c: Conn, path: string) {
  const res = await $.http.fetch(c.base + path, { headers: { authorization: `Bearer ${c.token}` } })
  if (!res.ok) throw new Error(res.status === 401 ? 'token rejected' : `HTTP ${res.status}`)
  return JSON.parse(res.text)
}

async function refresh($: EngineInterface, query?: string) {
  const q = query ?? (await read($, view)).query
  const [work, personal] = await Promise.all(ACCOUNTS.map(a => readProfile($, a)))
  const profiles = { work, personal }
  const c = await connection($)
  if ('problem' in c) {
    await update($, view, (v): TwinView => ({ ...v, profiles, connector: 'not-set-up', error: c.problem, query: q }))
    return
  }
  try {
    const [who, { handoff }, { items: recent }] = await Promise.all([
      api($, c, '/api/whoami'),
      api($, c, '/api/handoff'),
      api($, c, '/api/history?limit=200'),
    ])
    const found: TwinItem[] = q ? (await api($, c, `/api/history?limit=30&q=${encodeURIComponent(q)}`)).items : recent
    for (const a of ACCOUNTS) profiles[a].lastActivity = (recent as TwinItem[]).find(i => i.space === a)?.at
    await update($, view, (v): TwinView => ({
      ...v,
      session: who.space === 'personal' ? 'personal' : 'work',
      profiles,
      connector: 'ok',
      error: undefined,
      handoff: handoff ?? undefined,
      items: found.filter(i => !(handoff && i.id === handoff.id)).slice(0, 30),
      query: q,
    }))
  } catch (err) {
    await update($, view, (v): TwinView => ({
      ...v,
      profiles,
      connector: 'down',
      error: `Memory not reachable at ${c.base} (${(err as Error).message}).`,
      query: q,
    }))
  }
}

// Where the claude command lives; the desktop app's PATH may not include it.
async function claudeBinary($: EngineInterface): Promise<string> {
  const h = await home($)
  for (const p of ['/opt/homebrew/bin/claude', '/usr/local/bin/claude', `${h}/.local/bin/claude`, `${h}/.claude/local/claude`]) {
    try {
      if ((await $.fs.stat(p)).kind !== 'dir') return p
    } catch {
      /* not here */
    }
  }
  return 'claude'
}

// Runs `claude auth login` for that account's profile; the browser opens for the sign-in.
async function logIn($: EngineInterface, account: TwinAccount) {
  const dir = PROFILE_DIR[account]
  const bin = await claudeBinary($)
  const argv = dir
    ? ['/usr/bin/env', `CLAUDE_CONFIG_DIR=${await home($)}/${dir}`, bin, 'auth', 'login']
    : ['/usr/bin/env', '-u', 'CLAUDE_CONFIG_DIR', bin, 'auth', 'login']
  const manual = `Run ${COMMAND[account]} in a terminal and type /login.`
  await update($, view, (v): TwinView => ({
    ...v,
    login: { account, state: 'running', message: `Opening the browser to sign in to ${LABEL[account]}…` },
  }))
  try {
    const run = $.process.spawn({ argv })
    for await (const { text } of run) {
      const url = text.match(/https:\/\/\S+/)?.[0]
      if (url) await update($, view, (v): TwinView => ({ ...v, login: { ...v.login!, url } }))
    }
    const { code } = await run.result
    await update($, view, (v): TwinView => ({
      ...v,
      login:
        code === 0
          ? { account, state: 'done', message: `${LABEL[account]} signed in.` }
          : { account, state: 'failed', message: `Sign-in did not finish. ${manual}` },
    }))
  } catch {
    await update($, view, (v): TwinView => ({ ...v, login: { account, state: 'failed', message: `Could not start sign-in here. ${manual}` } }))
  }
  await refresh($)
}

export const register: Register = (on, options) => {
  settings = options

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'twin', description: 'Open the ClaudeTwin panel: both accounts, shared memory, handoffs' })
    void refresh($)
    $.clock.every(30_000, () => refresh($))
    return next(e)
  })

  on('command.run', { command: 'twin' }, async $ => {
    await $.ui.open({ id: PANE, title: 'ClaudeTwin' })
    await refresh($)
    return { text: 'ClaudeTwin panel opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    // Not every surface has a text field; without one the panel shows recent items only.
    const Input = 'Input' in ui ? ui.Input : undefined
    const v = await read($, view)
    const memory =
      v.connector === 'ok' ? 'synced' : v.connector === 'loading' ? 'checking…' : v.connector === 'down' ? 'not reachable' : 'not set up'

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>Accounts</Text>
          {ACCOUNTS.map(a => {
            const p = v.profiles[a]
            const isHere = v.session === a
            const isLoggingIn = v.login?.account === a && v.login.state === 'running'
            return (
              <Box key={`acct-${a}`} flexDirection="column">
                <Text>
                  <Text color={p.isLoggedIn ? 'green' : 'yellow'}>{p.isLoggedIn ? '●' : '○'} </Text>
                  <Text bold>{LABEL[a]}</Text>
                  {isHere && <Text dimColor> · this session</Text>}
                </Text>
                <Text dimColor>
                  {p.isLoggedIn ? [p.email, p.plan].filter(Boolean).join(' · ') : 'Not signed in'}
                  {p.isLoggedIn ? ` · ${ago(p.lastActivity)}` : ''}
                </Text>
                {!p.isLoggedIn && (
                  <Button key={`login-${a}`} variant="primary" onPress={() => void logIn($, a)}>
                    {isLoggingIn ? 'Signing in…' : `Log in to ${LABEL[a]}`}
                  </Button>
                )}
                {p.isLoggedIn && !isHere && <Text dimColor>Work in it: run {COMMAND[a]} in a terminal.</Text>}
              </Box>
            )
          })}
          {v.login && (
            <Text key="login-msg" color={v.login.state === 'failed' ? 'red' : undefined} dimColor={v.login.state !== 'failed'}>
              {v.login.message}
              {v.login.url && v.login.state === 'running' ? ` If no browser opened: ${v.login.url}` : ''}
            </Text>
          )}
        </Box>

        <Box flexDirection="column">
          <Text>
            <Text bold>Shared memory</Text>
            <Text dimColor> · {memory}</Text>
          </Text>
          {v.error && <Text color="red">{v.error}</Text>}
          {v.handoff ? (
            <Box flexDirection="column">
              <Text>
                {v.handoff.title}
                <Text dimColor> · from {LABEL[v.handoff.space] ?? v.handoff.space} · {ago(v.handoff.at)}</Text>
              </Text>
              <Text dimColor>{oneLine(v.handoff.summary, 300)}</Text>
              {(v.handoff.nextSteps ?? []).slice(0, 3).map((s, i) => (
                <Text key={`step-${i}`} dimColor>
                  - {oneLine(s, 120)}
                </Text>
              ))}
            </Box>
          ) : (
            <Text dimColor>No handoff saved yet.</Text>
          )}
          <Box flexDirection="row" gap={1}>
            <Button key="continue" variant="primary" onPress={() => void $.prompt.submit({ text: CONTINUE_PROMPT })}>
              Continue here
            </Button>
            <Button key="save" onPress={() => void $.prompt.submit({ text: SAVE_PROMPT })}>
              Save handoff
            </Button>
            <Button key="refresh" onPress={() => void refresh($)}>
              Refresh
            </Button>
          </Box>
        </Box>

        <Box flexDirection="column">
          {Input && (
            <Input
              key="search"
              label="Search both accounts"
              placeholder="e.g. billing, deploy, bug"
              value={v.query}
              submitLabel="Search"
              onSubmit={(value: string) => void refresh($, value.trim())}
            />
          )}
          {v.items.length === 0 && v.connector === 'ok' && <Text dimColor>Nothing found.</Text>}
          {v.items.slice(0, 12).map(i => (
            <Text key={i.id}>
              <Text dimColor>
                {LABEL[i.space] ?? i.space} · {i.kind === 'handoff' ? 'handoff' : i.role === 'user' ? 'you' : 'Claude'} · {ago(i.at)}:{' '}
              </Text>
              {oneLine(i.kind === 'handoff' ? `${i.title}: ${i.summary}` : i.text)}
            </Text>
          ))}
        </Box>
      </Box>
    )
  })
}
