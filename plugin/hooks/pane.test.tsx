import { test, expect } from 'claude-code/testing'

const HOME = '/Users/me'
const NOW = new Date().toISOString()
const HANDOFF = {
  id: 'h1',
  kind: 'handoff',
  space: 'personal',
  at: NOW,
  title: 'Billing refactor',
  summary: 'Split billing into invoice and tax modules.',
  nextSteps: ['Write tax tests'],
}
const MESSAGE = { id: 'm1', kind: 'message', space: 'work', role: 'user', at: NOW, text: 'deploy the api' }
const OPTIONS = { connector_url: 'http://localhost:8788', account_token: 'w'.repeat(48) }
const PANE = {
  plugin: 'claudetwin',
  component: 'Pane',
  requestId: 'claudetwin',
  props: { title: 'ClaudeTwin', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const
const TWIN = { command: 'twin', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

const login = (email: string, type: string) => JSON.stringify({ oauthAccount: { emailAddress: email, organizationType: type } })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: both accounts, shared memory and history`, { options: OPTIONS }, async ($, on) => {
    const auth: string[] = []
    on('env.get', async (_$, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
    on('fs.read', async (_$, e) =>
      e.path === `${HOME}/.claude.json`
        ? { value: login('me@company.com', 'claude_team') }
        : e.path === `${HOME}/.claude-personal/.claude.json`
          ? { value: login('me@gmail.com', 'claude_max') }
          : { deny: 'no such file' },
    )
    on('http.fetch', async (_$, e) => {
      auth.push(e.init?.headers?.authorization ?? '')
      const body = e.url.endsWith('/api/whoami')
        ? { space: 'work', mode: 'shared' }
        : e.url.includes('/api/handoff')
          ? { handoff: HANDOFF }
          : { items: [HANDOFF, MESSAGE] }
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
    })
    on('ui.open', async () => ({ value: { isPlaced: true } }))

    await $.command.run(TWIN)
    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

    expect(auth.every(a => a === `Bearer ${OPTIONS.account_token}`)).toBe(true)
    expect(texts).toContain('me@company.com · team')
    expect(texts).toContain('me@gmail.com · max')
    expect(texts).toContain('this session')
    expect(texts).toContain('run claude-personal')
    expect(texts).toContain('synced')
    expect(texts).toContain('Billing refactor')
    expect(texts).toContain('deploy the api')
    expect(await ui.find({ key: 'login-personal' })).toBeFalsy()
  })

  test(`${surface}: a signed-out account gets a Log in button that runs claude auth login for its profile`, { options: OPTIONS }, async ($, on) => {
    const spawned: string[][] = []
    let personalSignedIn = false
    on('env.get', async (_$, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
    on('fs.read', async (_$, e) =>
      e.path === `${HOME}/.claude.json`
        ? { value: login('me@company.com', 'claude_team') }
        : personalSignedIn
          ? { value: login('me@gmail.com', 'claude_max') }
          : { value: '{}' },
    )
    on('fs.stat', async () => ({ deny: 'missing' }))
    on('http.fetch', async (_$, e) => {
      const body = e.url.endsWith('/api/whoami') ? { space: 'work', mode: 'shared' } : e.url.includes('/api/handoff') ? { handoff: null } : { items: [] }
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
    })
    on('process.spawn', async function* (_$, e) {
      spawned.push([...e.argv])
      personalSignedIn = true
      yield { stream: 'stdout' as const, text: 'Opening https://claude.ai/oauth/authorize?x=1\n' }
      return { value: { code: 0, signal: null } }
    })
    on('ui.open', async () => ({ value: { isPlaced: true } }))

    await $.command.run(TWIN)
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')).toContain('Not signed in')

    await ui.press({ key: 'login-personal' })

    expect(spawned).toEqual([['/usr/bin/env', `CLAUDE_CONFIG_DIR=${HOME}/.claude-personal`, 'claude', 'auth', 'login']])
    const after = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    expect(after).toContain('Personal signed in.')
    expect(after).toContain('me@gmail.com')
    expect(await ui.find({ key: 'login-personal' })).toBeFalsy()
  })

  test(`${surface}: says so when the memory is down`, { options: OPTIONS }, async ($, on) => {
    on('env.get', async (_$, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
    on('fs.read', async () => ({ value: '{}' }))
    on('http.fetch', async () => ({ value: { status: 502, ok: false, headers: {}, text: '' } }))
    on('ui.open', async () => ({ value: { isPlaced: true } }))

    await $.command.run(TWIN)
    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    expect(texts).toContain('not reachable')
    expect(await ui.find({ key: 'login-work' })).toBeTruthy()
  })
}
