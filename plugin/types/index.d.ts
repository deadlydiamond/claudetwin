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

export type TwinStats = {
  messages: Partial<Record<string, number>>
  handoffs: number
  oldest?: string
}

export type TwinView = {
  // The Claude account signed in where this panel runs.
  account: TwinProfile
  connector: 'ok' | 'down' | 'not-set-up' | 'loading'
  error?: string
  handoff?: TwinItem
  items: TwinItem[]
  query: string
  sync?: TwinSync
  showSwitchSteps?: boolean
  stats?: TwinStats
}

declare module 'claude-code' {
  interface PluginState {
    claudetwin: { view: TwinView }
  }
}
