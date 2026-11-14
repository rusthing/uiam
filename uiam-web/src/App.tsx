/**
 * 应用入口：一个桌面，没有路由。
 *
 * Provider 的顺序是有讲究的：
 * `Toast`（任何一层都可能弹提示）→ `GatewayList`（数据底座）→ `Overview`（桌面组件用的
 * 聚合数据）→ `Shell`（窗口与 Dock 状态）→ 桌面本体。反过来会让某个组件在挂载时
 * 拿不到 context 而抛错，且报错位置离真正的原因很远。
 */
import { ToastProvider } from './components/Toast'
import { GatewayListProvider } from './state/GatewayList'
import { OverviewProvider } from './shell/overview'
import { ShellProvider } from './shell/state'
import { Desktop } from './shell/Desktop'
import { Dock } from './shell/Dock'
import { Launchpad } from './shell/Launchpad'
import { MenuBar } from './shell/MenuBar'

export function App() {
  return (
    <ToastProvider>
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
    </ToastProvider>
  )
}
