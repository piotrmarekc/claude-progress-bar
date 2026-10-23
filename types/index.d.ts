export type Item = { id: string; label: string; done: number; total: number; unit: string; rate: number }
export type AgentRow = { id: string; label: string; state: 'running' | 'waiting' | 'done' | 'failed'; ms: number; calls: number }

declare module 'claude-code' {
  interface PluginState {
    'progress-bar': { items: Item[]; agents: AgentRow[] }
  }
}
