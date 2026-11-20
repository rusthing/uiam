/**
 * 统一会话桥接。
 *
 * 其余控制台把会话放在 `adm.auth.session`（同源 localStorage，按 origin 共享）。
 * uiam 一期没有登录，用 `uiam-operator-id` 顶替；这里只做一件事：登录态存在时把
 * userId 回填给旧的操作者逻辑，让网关写接口的审计 ID 与控制台保持一致。
 *
 * 刻意不在这里做登录拦截：桌面本身仍可离线打开（网关配置要能看），登录页由各
 * 控制台自己负责。这样既统一了身份，又不把 uiam 变成所有应用的鉴权网关。
 */
export const SESSION_KEY = 'adm.auth.session'
export const SESSION_EXPIRED_EVENT = 'rusthing:session-expired'

interface SharedSession {
  token?: string
  userId?: number | string
  [key: string]: unknown
}

const OPERATOR_KEY = 'uiam-operator-id'

export function readSharedSession(): SharedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as SharedSession
  } catch {
    return null
  }
}

/**
 * 把统一会话里的 userId 回填到 uiam 的操作者 ID。
 *
 * 覆盖规则保守一点：只有「没填过」或「还是默认值 1」时才覆盖。用户在系统设置里
 * 手填了别的值，就尊重手填值，避免刷新一次被悄悄改回去。
 */
export function syncOperatorFromSession(): void {
  const session = readSharedSession()
  if (!session || session.userId === undefined || session.userId === null) return
  let current: string | null = null
  try {
    current = localStorage.getItem(OPERATOR_KEY)
  } catch {
    return
  }
  if (current && current !== '1') return
  try {
    localStorage.setItem(OPERATOR_KEY, String(session.userId))
  } catch {
    // 隐私模式下写不进去：保持现状即可，不影响桌面启动
  }
}

/** 订阅统一会话过期事件；各控制台在 401 时会广播它 */
export function subscribeSessionExpired(listener: () => void): () => void {
  window.addEventListener(SESSION_EXPIRED_EVENT, listener)
  return () => window.removeEventListener(SESSION_EXPIRED_EVENT, listener)
}
