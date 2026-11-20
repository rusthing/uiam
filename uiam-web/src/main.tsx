import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { initTheme } from './lib/theme'
import { attachStorageSync, initPreferences } from './lib/preferences'
import { initSite } from './lib/site'
import { syncOperatorFromSession } from './lib/session'
import { initAppearance } from './shell/widgetAppearance'

// 主题的初值已经由 index.html 里的内联脚本写进 <html data-theme>，
// 这里只是把模块内状态对齐过去，避免首次切换时判断错方向。
initTheme()
// 站点标题/图标先按本地或构建默认值落地，远端偏好 hydrate 后会通过订阅再覆盖一次。
initSite()
// 统一登录态存在时，把 userId 回填给 uiam 的 X-User-Id；没登录则保留原降级行为
syncOperatorFromSession()
initAppearance()
attachStorageSync()
void initPreferences()

const container = document.getElementById('root')
if (!container) throw new Error('#root 不存在')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
