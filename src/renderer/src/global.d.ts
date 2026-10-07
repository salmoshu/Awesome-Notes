/// <reference types="vite/client" />
import type { CSSProperties, RefObject } from 'react'
import type { AwesomeNotesBridge } from '@shared/types'

declare global {
  interface Window {
    awesomeNotes?: AwesomeNotesBridge
  }

  /** 构建期由 vite define 注入（package.json version） */
  const __APP_VERSION__: string

  /** Electron <webview> 标签（应用内外链浮层使用；纯 Web 预览回退 iframe） */
  namespace JSX {
    interface IntrinsicElements {
      webview: {
        src: string
        partition?: string
        style?: CSSProperties
        ref?: RefObject<WebviewTag | null>
      }
    }
  }

  interface WebviewTag extends HTMLElement {
    goBack(): void
    goForward(): void
    canGoBack(): boolean
    reload(): void
  }

  /** webview 自定义事件（did-navigate / did-fail-load）的载荷 */
  interface WebviewEventDetail extends Event {
    url?: string
    isMainFrame?: boolean
    errorDescription?: string
  }
}

export {}
