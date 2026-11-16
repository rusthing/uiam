/**
 * 偏好存储：一层可插拔的读写口，默认落 localStorage，配了远端地址才走服务端。
 *
 * 为什么不直接 new 一个 class：uiam-svr 目前只有网关相关的 8 组接口，**没有偏好
 * 设置接口**（见 `uiam-svr/src/web/router/`）。所以这里做的是「本地优先 + 可选远端
 * 同步」：各模块只管同步读写，远端 GET 成功时把快照写回本地并广播一次，PUT 失败
 * 静默回退，界面永远不会被网络拖住，也不假装后端已经存在。
 *
 * 远端契约（只有配置了 `VITE_PREFERENCES_URL` 才启用）：
 *   GET  <url>                 → `{ "uiam-desktop": ..., "uiam-widget-appearance": ..., "uiam-site": ... }`
 *   PUT  <url>  + X-User-Id   → 同一份快照；服务端自己决定按用户隔离
 */
import { getOperatorId } from './api'

/** 我们管的 key。theme / operator 有各自的历史格式，不在这里动，避免破坏旧数据 */
export const PREF_KEYS = [
  'uiam-desktop',
  'uiam-widget-appearance',
  'uiam-site',
  'uiam-gallery',
] as const

export type PrefKey = (typeof PREF_KEYS)[number]

const REMOTE_URL = (import.meta.env.VITE_PREFERENCES_URL ?? '').replace(/\/+$/, '')
const listeners = new Set<() => void>()

/** 订阅偏好变化：本地写入、远端 hydrate、其它标签页的 storage 事件都会触发 */
export function subscribePrefs(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify() {
  listeners.forEach((fn) => fn())
}

/**
 * 读一份偏好。localStorage 里既有 JSON 也有历史纯字符串，所以解析失败时原样返回，
 * 不把「旧格式」当成损坏数据丢掉。
 */
export function readPref<T>(key: PrefKey, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    try {
      return JSON.parse(raw) as T
    } catch {
      return raw as unknown as T
    }
  } catch {
    return fallback
  }
}

/** 写一份偏好：本地立刻生效并广播，远端（若启用）合并到一次防抖 PUT */
export function writePref(key: PrefKey, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 隐私模式下写不进去：本页仍然生效
  }
  notify()
  if (REMOTE_URL) schedulePush()
}

/** 远端是否启用：设置页要如实告诉用户「布局存本机」还是「已接配置中心」 */
export function preferencesBackend(): { kind: 'local' | 'remote'; label: string } {
  return REMOTE_URL
    ? { kind: 'remote', label: REMOTE_URL }
    : { kind: 'local', label: '本机 localStorage' }
}

function snapshot(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of PREF_KEYS) out[key] = readPref<unknown>(key, null)
  return out
}

let pushTimer: number | undefined
function schedulePush() {
  window.clearTimeout(pushTimer)
  pushTimer = window.setTimeout(() => {
    void fetch(REMOTE_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': getOperatorId() },
      body: JSON.stringify(snapshot()),
    }).catch(() => {
      // 配置中心不可达就只保留本地，不弹错：桌面是看状态的地方，不是报错的地方
    })
  }, 400)
}

/**
 * 启动时拉一次远端快照。只覆盖我们管的 key，且只在值确实存在时写回——
 * 服务端返回 `{}`（还没存过）不该把用户本机已经摆好的桌面清空。
 */
export async function initPreferences(): Promise<void> {
  if (!REMOTE_URL) return
  try {
    const res = await fetch(REMOTE_URL, { headers: { 'X-User-Id': getOperatorId() } })
    if (!res.ok) return
    const data = (await res.json()) as Record<string, unknown> | null
    if (!data || typeof data !== 'object') return
    let changed = false
    for (const key of PREF_KEYS) {
      if (data[key] === undefined || data[key] === null) continue
      localStorage.setItem(key, JSON.stringify(data[key]))
      changed = true
    }
    if (changed) notify()
  } catch {
    // 同上：连不上就当纯本地模式
  }
}

/** 其它标签页改了偏好时同步过来 */
export function attachStorageSync(): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key && (PREF_KEYS as readonly string[]).includes(e.key)) notify()
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
