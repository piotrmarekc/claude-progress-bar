export type Item = { id: string; label: string; done: number; total: number; unit: string; rate: number }

declare module 'claude-code' {
  interface PluginState {
    'progress-bar': { items: Item[] }
  }
}
