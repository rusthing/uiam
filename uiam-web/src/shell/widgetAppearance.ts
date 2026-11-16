/**
 * 桌面组件外观：把 macOS 27 的三个设置项映射成一套全局令牌。
 *
 *   · 图标与小组件样式 → `data-wg-style` = default / clear / tinted
 *   · Liquid Glass 滑块 → `glass` 0…1（0 最实、1 最透），**一个值全局共用**：
 *     Dock、菜单栏、窗口装饰、组件都读同一组变量，不允许各自调
 *   · 调暗桌面小组件     → `data-wg-dim` = auto / always / never；
 *     auto 由 `data-has-windows` 决定，有窗口盖住桌面时转单色
 *
 * 所有数值由这里算好写进 `:root`，CSS 里只做 `var()` 替换——`calc()` 塞进
 * `rgba()` 的 alpha 位在老 WebKit 上会静默失效，把计算放在 JS 更稳。
 *
 * ⚠️ 不引入 `backdrop-filter`。整套玻璃是「共享静态壁纸渐变 + 可调雾化层 +
 * 环形高光」，见 index.css 的 `.widget` 段。
 */
import { useSyncExternalStore } from 'react'
import { readPref, subscribePrefs, writePref } from '../lib/preferences'

export type WidgetStyle = 'default' | 'clear' | 'tinted'
export type WidgetDim = 'auto' | 'always' | 'never'

export interface WidgetAppearance {
  style: WidgetStyle
  /** 0 = 最不透明，1 = 最通透 */
  glass: number
  dim: WidgetDim
  /** tinted 模式的色调 */
  tint: string
}

const KEY = 'uiam-widget-appearance'

const DEFAULT: WidgetAppearance = {
  style: 'default',
  glass: 0.55,
  dim: 'auto',
  tint: '#3b6ac9',
}

const listeners = new Set<() => void>()

function clamp01(n: unknown, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback
}

function normalize(value: unknown): WidgetAppearance {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<WidgetAppearance>
  return {
    style:
      raw.style === 'clear' || raw.style === 'tinted' || raw.style === 'default'
        ? raw.style
        : DEFAULT.style,
    glass: clamp01(raw.glass, DEFAULT.glass),
    dim: raw.dim === 'always' || raw.dim === 'never' || raw.dim === 'auto' ? raw.dim : DEFAULT.dim,
    tint:
      typeof raw.tint === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.tint)
        ? raw.tint
        : DEFAULT.tint,
  }
}

let current: WidgetAppearance = normalize(readPref<unknown>(KEY, DEFAULT))

/** 辅助功能：降低透明度 / 增强对比度时退回不透明实底，也就是改造前那套 */
function reducedTransparency(): boolean {
  return (
    window.matchMedia('(prefers-reduced-transparency: reduce)').matches ||
    window.matchMedia('(prefers-contrast: more)').matches
  )
}

function apply() {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const opaque = reducedTransparency()
  const glass = opaque ? 0 : current.glass
  root.dataset.wgStyle = opaque ? 'default' : current.style
  root.dataset.wgDim = current.dim
  root.dataset.wgFallback = opaque ? 'opaque' : 'glass'
  root.style.setProperty('--wg-glass', String(glass))
  // 雾化层：越透越薄；实底上限 0.9，保证文字对比度
  const tintOpacity = 0.9 - glass * 0.68
  root.style.setProperty('--wg-tint-opacity', String(tintOpacity))
  // clear 外观底色本来就更暗，雾化层再薄一档才不会糊成一块
  root.style.setProperty('--wg-clear-opacity', String(tintOpacity * 0.72))
  // 全局玻璃叠加：菜单栏 / Dock / 窗口装饰共用，最透 0.06、最实 0.3
  root.style.setProperty('--glass-veil', String(0.06 + (1 - glass) * 0.24))
  // 边缘镜面高光：越透越亮
  root.style.setProperty('--wg-specular', String(0.3 + glass * 0.6))
  // 同一个滑块也控制 Dock 与窗口标题栏（macOS 27 是全局统一，不允许各调各的）
  root.style.setProperty('--dock-alpha-top', String(0.44 + (1 - glass) * 0.34))
  root.style.setProperty('--dock-alpha-bottom', String(0.28 + (1 - glass) * 0.3))
  root.style.setProperty('--win-bar-alpha', String(0.34 + (1 - glass) * 0.36))
  root.style.setProperty('--wg-tint-color', current.tint)
}

export function initAppearance(): WidgetAppearance {
  current = normalize(readPref<unknown>(KEY, DEFAULT))
  apply()
  for (const query of ['(prefers-reduced-transparency: reduce)', '(prefers-contrast: more)']) {
    window.matchMedia(query).addEventListener('change', apply)
  }
  return current
}

export function getAppearance(): WidgetAppearance {
  return current
}

export function setAppearance(patch: Partial<WidgetAppearance>) {
  current = normalize({ ...current, ...patch })
  apply()
  writePref(KEY, current)
  listeners.forEach((fn) => fn())
}

export function resetAppearance() {
  current = { ...DEFAULT }
  apply()
  writePref(KEY, current)
  listeners.forEach((fn) => fn())
}

/** 远端偏好 hydrate 后重新读一次本地值 */
subscribePrefs(() => {
  const next = normalize(readPref<unknown>(KEY, DEFAULT))
  if (JSON.stringify(next) === JSON.stringify(current)) return
  current = next
  apply()
  listeners.forEach((fn) => fn())
})

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useAppearance(): WidgetAppearance {
  return useSyncExternalStore(subscribe, getAppearance, getAppearance)
}

/** 桌面被窗口遮住时 auto 模式转单色；由 Desktop 在窗口数变化时调用 */
export function syncWindowPresence(hasWindows: boolean) {
  document.documentElement.dataset.hasWindows = hasWindows ? 'true' : 'false'
}
