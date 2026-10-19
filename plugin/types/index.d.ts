export type TwinAccount = 'work' | 'personal'

export type TwinItem = {
  id: string
  kind: 'handoff' | 'message'
  space: string
  at: string
  role?: 'user' | 'assistant'
  text?: string
  chatTitle?: string
  title?: string
  summary?: string
  nextSteps?: string[]
}

export type TwinProfile = {
  isLoggedIn: boolean
  email?: string
  plan?: string
  lastActivity?: string
}

export type TwinLogin = {
  account: TwinAccount
  state: 'running' | 'done' | 'failed'
  message: string
  url?: string
}

export type TwinSync = {
  state: 'running' | 'done' | 'failed'
  // Which profile is being read now, and how far it is.
  account?: TwinAccount
  done: number
  total: number
  added: number
  message?: string
  at?: string
}

export type TwinSwitch = {
  account: TwinAccount
  // unsynced: the shared memory is not up to date, so the person is asked before leaving.
  state: 'unsynced' | 'opening' | 'failed'
  message?: string
}

export type TwinStats = {
  messages: Partial<Record<string, number>>
  handoffs: number
  oldest?: string
}

export type TwinView = {
  session?: TwinAccount
  profiles: Record<TwinAccount, TwinProfile>
  login?: TwinLogin
  connector: 'ok' | 'down' | 'not-set-up' | 'loading'
  error?: string
  handoff?: TwinItem
  items: TwinItem[]
  query: string
  sync?: TwinSync
  switching?: TwinSwitch
  stats?: TwinStats
}

declare module 'claude-code' {
  interface PluginState {
    claudetwin: { view: TwinView }
  }
}
