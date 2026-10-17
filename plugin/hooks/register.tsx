// ClaudeTwin panel (/twin): both Claude accounts' sign-in status with a Log in
// button, the shared memory's health, the latest handoff with Continue / Save,
// search across both accounts' history, and a sync that imports every past
// Claude Code session of both profiles into the shared memory, with its progress.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TwinAccount, TwinItem, TwinProfile, TwinStats, TwinSync, TwinView } from '../types'

const PANE = 'claudetwin'
const ACCOUNTS: TwinAccount[] = ['work', 'personal']
const LABEL: Record<string, string> = { work: 'Company', personal: 'Personal', shared: 'Shared' }
// Each account's Claude Code profile: claude-work is the default config, claude-personal its own.
const PROFILE_DIR: Record<TwinAccount, string | undefined> = { work: undefined, personal: '.claude-personal' }
const COMMAND: Record<TwinAccount, string> = { work: 'claude-work', personal: 'claude-personal' }
// Must match .claude-plugin/plugin.json: the installed copy of the sync script lives under it.
const VERSION = '1.3.0'
const REPO_SCRIPT = '~/Projects/claudetwin/plugin/scripts/sync-history.mjs'

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

const expand = async ($: EngineInterface, p: string) => p.replace(/^~(?=\/)/, await home($))

// The connector's .env, when this machine has one: its port and both accounts' tokens.
async function connectorEnv($: EngineInterface): Promise<Record<string, string> | undefined> {
  const file = await expand($, String(settings.env_file || '~/Projects/claudetwin/connector/.env'))
  try {
    return Object.fromEntries(
      String(await $.fs.read(file))
        .split('\n')
        .filter(l => /^[A-Z_]+=/.test(l))
        .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
    )
  } catch {
    return undefined
  }
}

const isPersonalSession = async ($: EngineInterface) => /personal/i.test((await $.env.get('CLAUDE_CONFIG_DIR')) || '')

// The plugin's own options first; else the connector's .env, picking this profile's token.
async function connection($: EngineInterface): Promise<Conn | { problem: string }> {
  const url = String(settings.connector_url || '').replace(/\/+$/, '')
  const token = String(settings.account_token || '')
  if (url && token) return { base: url, token }

  const env = await connectorEnv($)
  if (!env) return { problem: `Connector not set up. Set the plugin's connector URL and account token.` }
  const fromEnv = env[(await isPersonalSession($)) ? 'CLAUDETWIN_PERSONAL_TOKEN' : 'CLAUDETWIN_WORK_TOKEN']
  if (!fromEnv) return { problem: `No token found. Set the plugin's connector URL and account token.` }
  return { base: url || `http://localhost:${env.PORT || 8787}`, token: fromEnv }
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
    const [who, { handoff }, { items: recent }, stats] = await Promise.all([
      api($, c, '/api/whoami'),
      api($, c, '/api/handoff'),
      api($, c, '/api/history?limit=200'),
      // Older connectors have no stats; the panel then just leaves the count out.
      api($, c, '/api/stats').catch(() => undefined) as Promise<TwinStats | undefined>,
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
      stats: stats && typeof stats.messages === 'object' ? stats : undefined,
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

// A node the host can start; the desktop app's PATH may not include nvm's.
async function nodeBinary($: EngineInterface): Promise<string | undefined> {
  const h = await home($)
  for (const p of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) if (await $.fs.exists(p)) return p
  try {
    const versions = (await $.fs.list(`${h}/.nvm/versions/node`)).filter(d => d.kind === 'dir').map(d => d.name)
    const newest = versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
    if (newest && (await $.fs.exists(`${h}/.nvm/versions/node/${newest}/bin/node`))) return `${h}/.nvm/versions/node/${newest}/bin/node`
  } catch {
    /* no nvm */
  }
  return undefined
}

// The installed copy of the sync script for this profile, else the repository's.
async function syncScript($: EngineInterface): Promise<string | undefined> {
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await home($)}/.claude`
  for (const p of [`${configDir}/plugins/cache/claudetwin/claudetwin/${VERSION}/scripts/sync-history.mjs`, await expand($, REPO_SCRIPT)]) {
    if (await $.fs.exists(p)) return p
  }
  return undefined
}

const setSync = ($: EngineInterface, fn: (s: TwinSync) => TwinSync) =>
  update($, view, (v): TwinView => ({ ...v, sync: fn(v.sync ?? { state: 'running', done: 0, total: 0, added: 0 }) }))

let isSyncing = false

// Imports every past session of both profiles (each with its own token); a re-run reads only
// transcripts that changed since, so it is quick after the first time.
async function syncHistory($: EngineInterface) {
  if (isSyncing) return
  isSyncing = true
  try {
    const c = await connection($)
    if ('problem' in c) return
    const [node, script] = await Promise.all([nodeBinary($), syncScript($)])
    if (!node || !script) {
      await setSync($, () => ({ state: 'failed', done: 0, total: 0, added: 0, message: 'Sync needs Node.js and the ClaudeTwin sync script.' }))
      return
    }
    const here: TwinAccount = (await isPersonalSession($)) ? 'personal' : 'work'
    const env = await connectorEnv($)
    const tokenFor = (a: TwinAccount) => (a === here ? c.token : env?.[a === 'work' ? 'CLAUDETWIN_WORK_TOKEN' : 'CLAUDETWIN_PERSONAL_TOKEN'])
    let added = 0
    for (const account of [here, ...ACCOUNTS.filter(a => a !== here)]) {
      const token = tokenFor(account)
      const dir = PROFILE_DIR[account] ? `${await home($)}/${PROFILE_DIR[account]}` : `${await home($)}/.claude`
      if (!token || !(await $.fs.exists(`${dir}/projects`))) continue
      await setSync($, () => ({ state: 'running', account, done: 0, total: 0, added, message: `Reading ${LABEL[account]} history…` }))
      const run = $.process.spawn({ argv: [node, script, c.base, token, dir] })
      let failed: string | undefined
      let buffer = ''
      for await (const { stream, text } of run) {
        if (stream !== 'stdout') continue
        buffer += text
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          let p: { phase: string; done?: number; total?: number; added?: number; message?: string }
          try {
            p = JSON.parse(line)
          } catch {
            continue
          }
          if (p.phase === 'error') failed = p.message
          else
            await setSync($, s => ({
              ...s,
              done: p.done ?? (p.phase === 'done' ? p.total ?? s.total : s.done),
              total: p.total ?? s.total,
              added: added + (p.added ?? 0),
            }))
        }
      }
      const { code } = await run.result
      if (failed || code !== 0) {
        await setSync($, s => ({ ...s, state: 'failed', message: `${LABEL[account]} sync failed: ${failed ?? `exit ${code}`}` }))
        return
      }
      added = (await read($, view)).sync?.added ?? added
    }
    await setSync($, s => ({ ...s, state: 'done', account: undefined, added, message: undefined, at: new Date().toISOString() }))
  } catch (err) {
    await setSync($, s => ({ ...s, state: 'failed', message: `Sync could not run here (${(err as Error).message}).` }))
  } finally {
    isSyncing = false
    await refresh($)
  }
}

function bar(done: number, total: number, width = 20): string {
  const filled = total ? Math.round((done / total) * width) : 0
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

const count = (n = 0) => n.toLocaleString('en-US')

function since(iso?: string): string {
  if (!iso) return ''
  return ` · since ${new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
}

export const register: Register = (on, options) => {
  settings = options

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'twin', description: 'Open the ClaudeTwin panel: both accounts, shared memory, handoffs' })
    void refresh($).then(() => syncHistory($))
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
    const sync = v.sync
    const isSyncRunning = sync?.state === 'running'
    const total = Object.values(v.stats?.messages ?? {}).reduce((a: number, b) => a + (b ?? 0), 0)
    const memory =
      v.connector === 'ok' ? (isSyncRunning ? 'syncing…' : 'synced') : v.connector === 'loading' ? 'checking…' : v.connector === 'down' ? 'not reachable' : 'not set up'

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
          {v.stats && (
            <Text key="stats" dimColor>
              {count(total)} messages ({ACCOUNTS.map(a => `${LABEL[a]} ${count(v.stats!.messages[a])}`).join(', ')}) · {count(v.stats.handoffs)} handoffs
              {since(v.stats.oldest)}
            </Text>
          )}
          {isSyncRunning && (
            <Box key="sync-progress" flexDirection="column">
              <Text>
                <Text color="cyan">{bar(sync.done, sync.total)} </Text>
                <Text bold>{sync.total ? `${Math.floor((sync.done / sync.total) * 100)}%` : '…'}</Text>
              </Text>
              <Text dimColor>
                {sync.total ? `Syncing ${LABEL[sync.account ?? 'work']} history · ${count(sync.done)}/${count(sync.total)} sessions` : sync.message}
                {` · ${count(sync.added)} new messages`}
              </Text>
            </Box>
          )}
          {sync?.state === 'done' && (
            <Text key="sync-done" dimColor>
              History synced {ago(sync.at)}
              {sync.added ? ` · ${count(sync.added)} new messages` : ' · up to date'}
            </Text>
          )}
          {sync?.state === 'failed' && (
            <Text key="sync-failed" color="red">
              {sync.message}
            </Text>
          )}
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
            <Button key="sync" onPress={() => void syncHistory($)}>
              {isSyncRunning ? 'Syncing…' : 'Sync all history'}
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
