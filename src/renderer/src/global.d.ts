import type { AwesomeNotesBridge } from '@shared/types'

declare global {
  interface Window {
    awesomeNotes?: AwesomeNotesBridge
  }
}

export {}
