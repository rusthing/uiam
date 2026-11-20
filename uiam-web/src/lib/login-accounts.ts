/**
 * 登录账户记忆：登录成功后记下账号，锁屏上以头像列表让用户直接选。
 *
 * 只存账号、展示名与最近登录时间——不存密码、也不存令牌（令牌仍由 auth-core
 * 的 adm.auth.session 单独管理）。放在本机 localStorage，未登录时也能读到，
 * 所以不接偏好存储那套（它会带 X-User-Id 上送，登录前拿不到正确的用户）。
 */
import { useSyncExternalStore } from 'react'

/** 一个可选的登录账户 */
export interface LoginAccount {
  /** 登录名，选中后回填到账号框 */
  account: string
  /** 展示名，优先取昵称 */
  name: string
  /** 用户 ID，仅作记录，不参与登录 */
  userId?: string
  /** 最近一次登录成功的时间（毫秒） */
  lastLoginMs: number
}

const KEY = 'uiam.login.accounts'
/** 最多记几个，避免锁屏被历史账号淹没 */
const MAX_ACCOUNTS = 6

const listeners = new Set<() => void>()

function normalize(value: unknown): LoginAccount[] {
  if (!Array.isArray(value)) return []
  const out: LoginAccount[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Partial<LoginAccount>
    const account = typeof raw.account === 'string' ? raw.account.trim() : ''
    if (!account) continue
    const key = account.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      account,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 32) : account,
      userId: typeof raw.userId === 'string' && raw.userId ? raw.userId : undefined,
      lastLoginMs:
        typeof raw.lastLoginMs === 'number' && Number.isFinite(raw.lastLoginMs) ? raw.lastLoginMs : 0,
    })
  }
  return out.sort((a, b) => b.lastLoginMs - a.lastLoginMs).slice(0, MAX_ACCOUNTS)
}

function readRaw(): LoginAccount[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? normalize(JSON.parse(raw) as unknown) : []
  } catch {
    return []
  }
}

function writeRaw(value: LoginAccount[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    /* 隐私模式下写不进去：本次会话仍能登录，只是下次不会记住 */
  }
}

/** 模块内缓存：useSyncExternalStore 的快照必须引用稳定，否则会反复重渲染 */
let current: LoginAccount[] = readRaw()

function notify() {
  listeners.forEach((fn) => fn())
}

/** 其它标签页改了账户列表时同步过来 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== KEY) return
    const next = readRaw()
    if (JSON.stringify(next) === JSON.stringify(current)) return
    current = next
    notify()
  })
}

/** 读取已记住的账户（按最近登录倒序） */
export function readLoginAccounts(): LoginAccount[] {
  return current
}

/**
 * 登录成功后记住账户。同一账号重复登录只更新时间与展示名，不会累积重复项。
 *
 * @param account 本次登录用的账号
 * @param info 会话里的展示名与用户 ID
 */
export function rememberLoginAccount(
  account: string,
  info: { name?: string; userId?: string } = {},
): void {
  const login = account.trim()
  if (!login) return
  const entry: LoginAccount = {
    account: login,
    name: info.name?.trim() || login,
    userId: info.userId || undefined,
    lastLoginMs: Date.now(),
  }
  const next = current.filter((a) => a.account.toLowerCase() !== login.toLowerCase())
  next.unshift(entry)
  current = next.slice(0, MAX_ACCOUNTS)
  writeRaw(current)
  notify()
}

/** 从锁屏上忘掉一个账户；不影响当前会话或别处的登录态 */
export function forgetLoginAccount(account: string): void {
  const login = account.trim().toLowerCase()
  current = current.filter((a) => a.account.toLowerCase() !== login)
  writeRaw(current)
  notify()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 锁屏用：账户列表变化（含其它标签页）时自动重渲染 */
export function useLoginAccounts(): LoginAccount[] {
  return useSyncExternalStore(subscribe, readLoginAccounts, readLoginAccounts)
}
