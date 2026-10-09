export type QueuedPrompt = { id: string; text: string }
export type Flash = { id: string; dir: number; step: number; seq: number }

declare module 'claude-code' {
  interface PluginState {
    'prompt-queue': {
      items: QueuedPrompt[]
      isOpen: boolean
      mode: 'band' | 'pane'
      size: 'S' | 'M' | 'L'
      start: number
      history: number[]
      numCols: number
      tone: number
      isAuto: boolean
      autoLimit: number
      autoLeft: number
      delay: number
      countdown: number
      flash: Flash | null
      isHover: boolean
      editId: string
      draft: string
      rev: number
      isTyping: boolean
    }
  }
}
