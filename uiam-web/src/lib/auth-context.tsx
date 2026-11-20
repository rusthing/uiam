/**
 * uiam 宿主的登录态：把 auth-core 的 localStorage 会话变成 React 可订阅状态。
 *
 * 认证逻辑本身不在这一层——loginWithPassword / logoutRemote / readSession 都来自
 * 六端共用的 auth-core，行为（session key、SM3、过期判定、401 广播）和别的控制台
 * 完全一致。这里只做两件事：
 *   1. 用 state 包一层，让登录屏与顶栏在同一棵 React 树里同步；
 *   2. 订阅过期/跨标签 storage 事件，避免别的窗口登出后本窗口还停在「已登录」；
 *   3. 登录成功时把账号记进本机，下次锁屏可以直接选这个用户。
 *
 * 开发构建（VITE_AUTH_MODE=disabled）下 readSession 恒返回系统账号，登录屏不会
 * 出现，桌面照常打开——本地开发不被登录挡住。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  AUTH_REQUIRED,
  SESSION_KEY,
  loginWithPassword,
  logoutRemote,
  readSession,
  subscribeSessionExpired,
  type AuthSession,
} from './auth-core'
import { syncOperatorFromSession } from './session'
import { rememberLoginAccount } from './login-accounts'

interface AuthState {
  session: AuthSession | null
  authRequired: boolean
  login: (account: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(() => readSession())

  useEffect(() => {
    const refresh = () => setSession(readSession())
    const off = subscribeSessionExpired(refresh)
    const onStorage = (event: StorageEvent) => {
      if (event.key === SESSION_KEY) refresh()
    }
    window.addEventListener('storage', onStorage)
    // 长时间停在登录页也会过期，定时重读让过期判定落地（isExpired 用本地时间）
    const timer = window.setInterval(refresh, 30_000)
    return () => {
      off()
      window.removeEventListener('storage', onStorage)
      window.clearInterval(timer)
    }
  }, [])

  const login = useCallback(async (account: string, password: string) => {
    const next = await loginWithPassword(account, password)
    setSession(next)
    // 登录成功才记账户；只存账号与展示名，密码/令牌都不进这份历史
    rememberLoginAccount(account, { name: next.nickName || next.name, userId: next.userId })
    // 登录成功后把 userId 回填给网关写接口的审计 ID（与独立站一致）
    syncOperatorFromSession()
  }, [])

  const logout = useCallback(async () => {
    await logoutRemote()
    setSession(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({ session, authRequired: AUTH_REQUIRED, login, logout }),
    [session, login, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用')
  return ctx
}
