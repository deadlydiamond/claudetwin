// ClaudeTwin panel (/twin): both Claude accounts' sign-in status with a Log in
// button, the shared memory's health, the latest handoff with Continue / Save,
// search across both accounts' history, and a sync that imports every past
// Claude Code session of both profiles into the shared memory, with its progress.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { BRAND, headerSvg, progressSvg, progressText } from './brand'
import type { TwinAccount, TwinItem, TwinProfile, TwinStats, TwinSwitch, TwinSync, TwinView } from '../types'

const PANE = 'claudetwin'
const ACCOUNTS: TwinAccount[] = ['work', 'personal']
const LABEL: Record<string, string> = { work: 'Company', personal: 'Personal', shared: 'Shared' }
// Each account's Claude Code profile: claude-work is the default config, claude-personal its own.
const PROFILE_DIR: Record<TwinAccount, string | undefined> = { work: undefined, personal: '.claude-personal' }
const COMMAND: Record<TwinAccount, string> = { work: 'claude-work', personal: 'claude-personal' }
// Must match .claude-plugin/plugin.json: the installed copy of the sync script lives under it.
const VERSION = '1.5.0'
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

// The installed copy of one of the plugin's scripts for this profile, else the repository's.
async function scriptFor($: EngineInterface, name: string): Promise<string | undefined> {
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await home($)}/.claude`
  for (const p of [`${configDir}/plugins/cache/claudetwin/claudetwin/${VERSION}/scripts/${name}`, await expand($, REPO_SCRIPT.replace('sync-history.mjs', name))]) {
    if (await $.fs.exists(p)) return p
  }
  return undefined
}
const syncScript = ($: EngineInterface) => scriptFor($, 'sync-history.mjs')

// A switch is safe when the last sync finished a short while ago; otherwise the person is asked first.
const FRESH_MS = 10 * 60_000
const isFresh = (v: TwinView) => v.sync?.state === 'done' && !!v.sync.at && Date.now() - Date.parse(v.sync.at) < FRESH_MS

const setSwitching = ($: EngineInterface, switching?: TwinSwitch) => update($, view, (v): TwinView => ({ ...v, switching }))

// Opens the other account's Claude Code in a new Terminal window (its own profile, so no logout is needed).
async function openAccount($: EngineInterface, account: TwinAccount) {
  await setSwitching($, { account, state: 'opening', message: `Opening ${LABEL[account]} in a new Terminal window…` })
  try {
    const run = $.process.spawn({
      argv: ['/usr/bin/osascript', '-e', `tell application "Terminal" to do script "${COMMAND[account]}"`, '-e', 'tell application "Terminal" to activate'],
    })
    for await (const _ of run) {
      /* nothing to read */
    }
    const { code } = await run.result
    if (code !== 0) throw new Error(`exit ${code}`)
    await setSwitching($, undefined)
  } catch {
    await setSwitching($, { account, state: 'failed', message: `Could not open a window here. Run ${COMMAND[account]} in a terminal.` })
  }
}

// The Switch button: straight to the other account when memory is synced, else ask first.
async function switchTo($: EngineInterface, account: TwinAccount) {
  if (isFresh(await read($, view))) return openAccount($, account)
  await setSwitching($, { account, state: 'unsynced' })
}

// "Sync now": brings the shared memory up to date, then opens the account.
async function syncThenSwitch($: EngineInterface, account: TwinAccount) {
  await setSwitching($, { account, state: 'opening', message: 'Syncing the shared memory first…' })
  await syncHistory($)
  if ((await read($, view)).sync?.state === 'done') return openAccount($, account)
  await setSwitching($, { account, state: 'failed', message: 'The sync did not finish, so the account was not opened. Fix the sync or switch anyway.' })
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

const count = (n = 0) => n.toLocaleString('en-US')

function since(iso?: string): string {
  if (!iso) return ''
  return `${new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
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
    // Not every surface has a text field or vector drawings; without them the panel falls back to text.
    const Input = 'Input' in ui ? ui.Input : undefined
    // The terminal draws no vectors; there the header and the bar are text.
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : undefined
    const v = await read($, view)
    const sync = v.sync
    const isSyncRunning = sync?.state === 'running'
    const fraction = sync?.total ? sync.done / sync.total : 0
    const status =
      v.connector === 'ok'
        ? isSyncRunning
          ? { label: 'Syncing', tone: 'busy' as const, text: 'syncing…' }
          : { label: 'Synced', tone: 'ok' as const, text: 'synced' }
        : v.connector === 'loading'
          ? { label: 'Checking', tone: 'busy' as const, text: 'checking…' }
          : v.connector === 'down'
            ? { label: 'Offline', tone: 'off' as const, text: 'not reachable' }
            : { label: 'Not set up', tone: 'off' as const, text: 'not set up' }
    const toneColor = status.tone === 'ok' ? 'success' : status.tone === 'busy' ? BRAND.cyan : 'warning'
    const sameAccount =
      !!v.profiles.work.email && v.profiles.work.email.toLowerCase() === v.profiles.personal.email?.toLowerCase()
    const total = Object.values(v.stats?.messages ?? {}).reduce((a: number, b) => a + (b ?? 0), 0)

    const Section = ({ title, aside, children }: { title: string; aside?: string; children?: JSX.Children }) => (
      <Box flexDirection="column" gap={1} borderStyle="round" borderColor="subtle" paddingX={2} paddingY={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold dimColor>
            {title.toUpperCase()}
          </Text>
          {aside ? (
            <Text dimColor>
              {aside}
            </Text>
          ) : null}
        </Box>
        {children}
      </Box>
    )

    const Stat = ({ id, value, label }: { id: string; value: string; label: string }) => (
      <Box key={id} flexDirection="column" flexGrow={1} minWidth={10}>
        <Text bold>
          {value}
        </Text>
        <Text dimColor>
          {label}
        </Text>
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1} paddingX={1} paddingY={1}>
        {Svg ? (
          <Svg key="brand" source={headerSvg(status)} alt={`ClaudeTwin by ${BRAND.author}. Shared memory ${status.text}.`} width={360} height={56} />
        ) : (
          <Box key="brand" flexDirection="column">
            <Text>
              <Text bold color={BRAND.cyan}>
                ClaudeTwin
              </Text>
              <Text color={toneColor}> ● </Text>
              <Text dimColor>shared memory {status.text}</Text>
            </Text>
            <Text dimColor>
              by {BRAND.author} · {BRAND.tagline}
            </Text>
          </Box>
        )}
        {Svg && (
          <Text key="status-line" dimColor>
            Shared memory {status.text}
          </Text>
        )}

        <Section title="Accounts">
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            {ACCOUNTS.map(a => {
              const p = v.profiles[a]
              const isHere = v.session === a
              const isLoggingIn = v.login?.account === a && v.login.state === 'running'
              return (
                <Box key={`acct-${a}`} flexDirection="column" flexGrow={1} minWidth={28} gap={1} borderStyle="round" borderColor="subtle" paddingX={2} paddingY={1}>
                  <Text>
                    <Text color={p.isLoggedIn ? 'success' : 'warning'}>{p.isLoggedIn ? '●' : '○'} </Text>
                    <Text bold>
                      {LABEL[a]}
                    </Text>
                    {isHere && <Text color={BRAND.cyan}> · this session</Text>}
                  </Text>
                  <Text dimColor wrap="truncate-end">
                    {p.isLoggedIn ? [p.email, p.plan].filter(Boolean).join(' · ') : 'Not signed in'}
                  </Text>
                  {p.isLoggedIn && (
                    <Text dimColor>
                      Last active {ago(p.lastActivity)}
                    </Text>
                  )}
                  {!p.isLoggedIn && (
                    <Button key={`login-${a}`} variant="primary" onPress={() => void logIn($, a)}>
                      {isLoggingIn ? 'Signing in…' : `Log in to ${LABEL[a]}`}
                    </Button>
                  )}
                  {p.isLoggedIn && !isHere && (
                    <Button key={`switch-${a}`} variant="primary" onPress={() => void switchTo($, a)}>
                      {`Switch to ${LABEL[a]}`}
                    </Button>
                  )}
                </Box>
              )
            })}
          </Box>
          {!(v.profiles.work.isLoggedIn && v.profiles.personal.isLoggedIn) && (
            <Text key="onboarding" dimColor>
              Set up both accounts once: sign in to each below. After that, switch between them from here, with no logging out.
            </Text>
          )}
          {v.switching?.state === 'unsynced' && (
            <Box key="switch-alert" flexDirection="column" gap={1} borderStyle="round" borderColor="warning" paddingX={2} paddingY={1}>
              <Text color="warning" bold>
                The shared memory is not synced
              </Text>
              <Text>
                {LABEL[v.switching.account]} will not see what you did here until it is. Sync first, then switch.
              </Text>
              <Box flexDirection="row" gap={1} flexWrap="wrap">
                <Button key="sync-switch" variant="primary" onPress={() => void syncThenSwitch($, v.switching!.account)}>
                  Sync now and switch
                </Button>
                <Button key="switch-anyway" onPress={() => void openAccount($, v.switching!.account)}>
                  Switch anyway
                </Button>
                <Button key="switch-cancel" onPress={() => void setSwitching($, undefined)}>
                  Cancel
                </Button>
              </Box>
            </Box>
          )}
          {v.switching && v.switching.state !== 'unsynced' && (
            <Text key="switch-msg" color={v.switching.state === 'failed' ? 'error' : undefined} dimColor={v.switching.state !== 'failed'}>
              {v.switching.message}
            </Text>
          )}
          {sameAccount && (
            <Text key="same-account" color="warning">
              Both profiles are signed in to {v.profiles.work.email}. Use "Log in" on the Personal profile for your second account, instead of logging out here.
            </Text>
          )}
          {v.login && (
            <Text key="login-msg" color={v.login.state === 'failed' ? 'error' : undefined} dimColor={v.login.state !== 'failed'}>
              {v.login.message}
              {v.login.url && v.login.state === 'running' ? ` If no browser opened: ${v.login.url}` : ''}
            </Text>
          )}
        </Section>

        <Section title="Memory" aside={sync?.state === 'done' ? `Synced ${ago(sync.at)}` : undefined}>
          {v.error && <Text color="error">{v.error}</Text>}
          {v.stats && (
            <Box key="stats" flexDirection="row" flexWrap="wrap" gap={1}>
              <Stat id="stat-messages" value={count(total)} label="messages" />
              <Stat id="stat-handoffs" value={count(v.stats.handoffs)} label="handoffs" />
              <Stat id="stat-since" value={since(v.stats.oldest) || '-'} label="history since" />
            </Box>
          )}
          {v.stats && (
            <Text key="stats-split" dimColor>
              {ACCOUNTS.map(a => `${LABEL[a]} ${count(v.stats!.messages[a])}`).join(' · ')}
            </Text>
          )}
          {isSyncRunning && (
            <Box key="sync-progress" flexDirection="column" gap={0}>
              <Box flexDirection="row" justifyContent="space-between">
                <Text bold>
                  {sync.total ? `Syncing ${LABEL[sync.account ?? 'work']} history` : sync.message}
                </Text>
                <Text bold color={BRAND.cyan}>
                  {sync.total ? `${Math.floor(fraction * 100)}%` : '…'}
                </Text>
              </Box>
              {Svg ? (
                <Svg key="sync-bar" source={progressSvg(fraction)} alt={`${Math.floor(fraction * 100)}% synced`} width={360} height={8} />
              ) : (
                <Text key="sync-bar" color={BRAND.cyan}>
                  {progressText(fraction)}
                </Text>
              )}
              <Text dimColor>
                {sync.total ? `${count(sync.done)}/${count(sync.total)} sessions` : 'Looking for sessions'} · {count(sync.added)} new messages
              </Text>
            </Box>
          )}
          {sync?.state === 'done' && (
            <Text key="sync-done" dimColor>
              {sync.added ? `${count(sync.added)} new messages added` : 'Everything is up to date'}
            </Text>
          )}
          {sync?.state === 'failed' && (
            <Text key="sync-failed" color="error">
              {sync.message}
            </Text>
          )}
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Button key="sync" onPress={() => void syncHistory($)}>
              {isSyncRunning ? 'Syncing…' : 'Sync all history'}
            </Button>
            <Button key="refresh" onPress={() => void refresh($)}>
              Refresh
            </Button>
          </Box>
        </Section>

        <Section title="Latest handoff" aside={v.handoff ? `${LABEL[v.handoff.space] ?? v.handoff.space} · ${ago(v.handoff.at)}` : undefined}>
          {v.handoff ? (
            <Box flexDirection="column" gap={0}>
              <Text bold>
                {v.handoff.title}
              </Text>
              <Text dimColor>{oneLine(v.handoff.summary, 300)}</Text>
              {(v.handoff.nextSteps ?? []).slice(0, 3).map((s, i) => (
                <Text key={`step-${i}`}>
                  <Text color={BRAND.cyan}>→ </Text>
                  {oneLine(s, 120)}
                </Text>
              ))}
            </Box>
          ) : (
            <Text dimColor>No handoff saved yet. Save one before you switch accounts.</Text>
          )}
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Button key="continue" variant="primary" onPress={() => void $.prompt.submit({ text: CONTINUE_PROMPT })}>
              Continue here
            </Button>
            <Button key="save" onPress={() => void $.prompt.submit({ text: SAVE_PROMPT })}>
              Save handoff
            </Button>
          </Box>
        </Section>

        <Section title="History" aside={v.query ? `Results for "${oneLine(v.query, 30)}"` : 'Recent'}>
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
            <Box key={i.id} flexDirection="column">
              <Text dimColor>
                {LABEL[i.space] ?? i.space} · {i.kind === 'handoff' ? 'handoff' : i.role === 'user' ? 'you' : 'Claude'} · {ago(i.at)}
              </Text>
              <Text wrap="truncate-end">{oneLine(i.kind === 'handoff' ? `${i.title}: ${i.summary}` : i.text)}</Text>
            </Box>
          ))}
        </Section>
      </Box>
    )
  })
}
