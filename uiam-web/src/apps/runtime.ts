/**
 * 应用运行时契约。
 *
 * 桌面外壳只认这里的抽象：一个应用「是什么」（AppMeta）和「怎么活」（AppMode +
 * AppCaps）。真正的内容由适配器提供——internal 直接渲染组件，iframe 走文档，
 * external 开新标签页，后面的 federation / sandbox / webcomponent 各自补一个适配器即可。
 *
 * 能力（caps）是协商用的：不是每种模式都能同步主题、标题、路由和通知，宿主在
 * 发消息前先查 caps，子应用也能据此降级，避免出现「发了没人收」的静默失败。
 */
import type { ComponentType, LazyExoticComponent } from 'react'

export type AppMode =
  | 'internal'
  | 'iframe'
  | 'external'
  | 'federation'
  | 'sandbox'
  | 'webcomponent'

export interface AppCaps {
  theme: boolean
  title: boolean
  route: boolean
  toast: boolean
}

export const DEFAULT_CAPS: Record<AppMode, AppCaps> = {
  internal: { theme: true, title: true, route: true, toast: true },
  iframe: { theme: true, title: true, route: true, toast: true },
  external: { theme: false, title: false, route: false, toast: false },
  federation: { theme: true, title: true, route: true, toast: true },
  sandbox: { theme: true, title: true, route: true, toast: true },
  webcomponent: { theme: true, title: false, route: true, toast: true },
}

export type AppComponent =
  | ComponentType<Record<string, never>>
  | LazyExoticComponent<ComponentType<any>>

/** 合并默认能力与描述符里显式覆盖的能力 */
export function capsOf(app: { mode?: AppMode; caps?: Partial<AppCaps> }): AppCaps {
  return { ...DEFAULT_CAPS[app.mode ?? 'internal'], ...app.caps }
}
