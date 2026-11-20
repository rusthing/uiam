/**
 * 应用入口：一个桌面，没有路由。
 *
 * Provider 的顺序是有讲究的：
 * `Toast`（任何一层都可能弹提示）→ `GatewayList`（数据底座）→ `Overview`（桌面组件用的
 * 聚合数据）→ `Shell`（窗口与 Dock 状态）→ 桌面本体。反过来会让某个组件在挂载时
 * 拿不到 context 而抛错，且报错位置离真正的原因很远。
 */
import { useEffect } from 'react'
import { ToastProvider, useToast } from './components/Toast'
import { AuthProvider, useAuth } from './lib/auth-context'
import { subscribeSessionExpired } from './lib/session'
import { GatewayListProvider } from './state/GatewayList'
import { OverviewProvider } from './shell/overview'
import { ShellProvider } from './shell/state'
import { Desktop } from './shell/Desktop'
import { Dock } from './shell/Dock'
import { Launchpad } from './shell/Launchpad'
import { MenuBar } from './shell/MenuBar'
import { LoginScreen } from './shell/LoginScreen'

function SessionWatcher() {
  const toast = useToast()
  useEffect(
    () =>
      subscribeSessionExpired(() => {
        toast.error('登录已过期，请重新登录后再操作')
      }),
    [toast],
  )
  return null
}

/** 已登录的桌面：这些 Provider 只在有会话时挂载，未登录时不发任何业务请求。 */
function DesktopShell() {
  return (
    <GatewayListProvider>
      <OverviewProvider>
        <ShellProvider>
          <Desktop />
          <MenuBar />
          <Dock />
          <Launchpad />
        </ShellProvider>
      </OverviewProvider>
    </GatewayListProvider>
  )
}

/**
 * 登录门：生产构建下未登录只渲染锁屏，桌面（含联邦窗口）整体不挂载。
 *
 * 这样联邦子应用不会在没会话时先渲染出自己的登录页再被宿主的锁屏盖住——
 * 一处登录、一处会话，桌面里看到的每个窗口天然都是已登录态。开发构建
 * （AUTH_MODE=disabled）里 authRequired=false，直接进桌面，不挡本地调试。
 */
function AuthGate() {
  const { session, authRequired } = useAuth()
  if (authRequired && !session) return <LoginScreen />
  return <DesktopShell />
}

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <SessionWatcher />
        <AuthGate />
      </AuthProvider>
    </ToastProvider>
  )
}
