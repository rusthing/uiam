/**
 * 站点身份：顶部那个图标和标题，不再是硬编码的苹果标 + 假菜单。
 *
 * 两个来源，后者覆盖前者：
 *   1. 构建期 `VITE_SITE_NAME` / `VITE_SITE_ICON`（.env.*，部署时定品牌）
 *   2. 运行时「系统设置 → 站点」里改（走偏好存储，换浏览器/换设备跟随配置中心）
 *
 * `icon` 既可以是内置预设 id，也可以是一个图片 URL（含 data: / 相对路径）。
 * favicon 与 `document.title` 一并更新，别让标签页还写着旧名字。
 */
import { useSyncExternalStore } from 'react'
import { readPref, subscribePrefs, writePref } from './preferences'

export interface SiteConfig {
  name: string
  icon: string
}

/** 内置图标。刻意不放任何厂商 logo——这是站点自己的图标 */
export const SITE_ICONS: Record<string, { label: string; path: string }> = {
  gateway: {
    label: '网关',
    path: 'M12 2.8 3.6 6.4v5.1c0 5 3.5 8.4 8.4 9.7 4.9-1.3 8.4-4.7 8.4-9.7V6.4L12 2.8Zm0 3.1 5.6 2.3v3.3c0 3.5-2.3 6-5.6 7.1-3.3-1.1-5.6-3.6-5.6-7.1V8.2L12 5.9Zm-2.8 5.3h5.6v1.7H9.2v-1.7Z',
  },
  grid: {
    label: '网格',
    path: 'M3.6 3.6h6.6v6.6H3.6V3.6Zm10.2 0h6.6v6.6h-6.6V3.6ZM3.6 13.8h6.6v6.6H3.6v-6.6Zm10.2 0h6.6v6.6h-6.6v-6.6Z',
  },
  pulse: {
    label: '脉冲',
    path: 'M2.4 12.6h4.1l2.3-6.4 3.1 11.1 2.4-6.1h7.3v1.9h-6l-3.4 8.5-3-10.9-1.6 4.4H2.4v-2.5Z',
  },
  layers: {
    label: '层叠',
    path: 'M12 3.2 2.9 7.6 12 12l9.1-4.4L12 3.2Zm-9.1 8.3 9.1 4.4 9.1-4.4v2.1L12 18l-9.1-4.4v-2.1Zm0 4.4 9.1 4.4 9.1-4.4v2L12 22l-9.1-4.4v-2Z',
  },
}

const DEFAULT: SiteConfig = {
  name: import.meta.env.VITE_SITE_NAME?.trim() || 'uiam 网关管理面',
  icon: import.meta.env.VITE_SITE_ICON?.trim() || 'gateway',
}

const KEY = 'uiam-site'

function normalize(value: unknown): SiteConfig {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<SiteConfig>
  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 40) : DEFAULT.name,
    icon: typeof raw.icon === 'string' && raw.icon.trim() ? raw.icon.trim() : DEFAULT.icon,
  }
}

const listeners = new Set<() => void>()

let current: SiteConfig = normalize(readPref<unknown>(KEY, DEFAULT))

function faviconHref(config: SiteConfig): string {
  const preset = SITE_ICONS[config.icon]
  if (!preset) return config.icon
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="%230a84ff"/><path d="${preset.path}" fill="white"/></svg>`
  return `data:image/svg+xml,${svg}`
}

function applyDom(config: SiteConfig) {
  if (typeof document === 'undefined') return
  document.title = config.name
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.href = faviconHref(config)
}

/** 首屏就叫，避免标题先显示 index.html 里的旧值 */
export function initSite(): SiteConfig {
  current = normalize(readPref<unknown>(KEY, DEFAULT))
  applyDom(current)
  return current
}

export function getSiteConfig(): SiteConfig {
  return current
}

export function setSiteConfig(patch: Partial<SiteConfig>) {
  current = normalize({ ...current, ...patch })
  applyDom(current)
  writePref(KEY, current)
  listeners.forEach((fn) => fn())
}

export function resetSiteConfig() {
  current = { ...DEFAULT }
  applyDom(current)
  writePref(KEY, current)
  listeners.forEach((fn) => fn())
}

/** 远端 hydrate / 其它标签页改动后重读一次（useSyncExternalStore 要稳定引用） */
subscribePrefs(() => {
  const next = normalize(readPref<unknown>(KEY, DEFAULT))
  if (next.name === current.name && next.icon === current.icon) return
  current = next
  applyDom(current)
  listeners.forEach((fn) => fn())
})

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSiteConfig(): SiteConfig {
  return useSyncExternalStore(subscribe, getSiteConfig, getSiteConfig)
}

/** 图标渲染用：预设返回 SVG path，自定义 URL 返回 null（由调用方渲染 img） */
export function siteIconPath(icon: string): string | null {
  return SITE_ICONS[icon]?.path ?? null
}
