/**
 * 顶栏：左边是**站点自己的**图标与标题，右边是真正有行为的入口。
 *
 * 这里曾经是苹果 logo +「访达」+ 文件/编辑/显示/前往/窗口/帮助 的仿 macOS 菜单，
 * 其中五项点了没有任何反应；右侧还挂着 wifi / 电池 / 搜索三个装饰图标。既然这是
 * 一个网关管理面，不是 Mac 桌面模拟器，就把「点了不做事」的东西全部拿掉：
 * 品牌区改成可配置的站点身份，右侧只留编辑桌面、外观切换和时钟。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { currentTheme, subscribeTheme, toggleTheme } from '../lib/theme'
import { siteIconPath, useSiteConfig } from '../lib/site'
import { useShell } from './state'

const SUN = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
  >
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6L17 17M7 7L5.4 5.4" />
  </svg>
)

const MOON = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5a8.5 8.5 0 1 0 10.8 10.8Z" />
  </svg>
)

function clockText() {
  const d = new Date()
  const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  const p = (n: number) => (n < 10 ? `0${n}` : String(n))
  return `${d.getMonth() + 1}月${d.getDate()}日 ${wd} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 对齐到下一分钟刷新，不是每 20s 无脑刷一次——时钟不会漂在分钟边界外 */
function useClock() {
  const [now, setNow] = useState(clockText)
  useEffect(() => {
    let timer: number
    const tick = () => {
      setNow(clockText())
      const d = new Date()
      timer = window.setTimeout(tick, (60 - d.getSeconds()) * 1000 - d.getMilliseconds() + 20)
    }
    tick()
    return () => window.clearTimeout(timer)
  }, [])
  return now
}

export function MenuBar() {
  const shell = useShell()
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, currentTheme)
  const site = useSiteConfig()
  const themeRef = useRef<HTMLButtonElement>(null)
  const now = useClock()
  const path = siteIconPath(site.icon)

  return (
    <div className="menubar">
      <div className="mb-left">
        <button
          className="mb-brand"
          onClick={() => shell.openApp('settings')}
          title="站点设置：图标与标题"
          aria-label={`${site.name}，打开站点设置`}
        >
          {path ? (
            <svg className="mb-brand-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d={path} />
            </svg>
          ) : (
            <img className="mb-brand-icon" src={site.icon} alt="" />
          )}
          <span className="mb-brand-name">{site.name}</span>
        </button>
      </div>

      <div className="mb-right">
        <button
          className={`mb-status mb-act${shell.editing ? ' on' : ''}`}
          onClick={() => shell.setEditing(!shell.editing)}
          title={shell.editing ? '退出编辑（Esc）' : '编辑桌面上的组件'}
        >
          {shell.editing ? '完成' : '编辑桌面'}
        </button>
        <button
          ref={themeRef}
          className="mb-status"
          onClick={() => toggleTheme(themeRef.current)}
          title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
          aria-label="切换外观"
        >
          {theme === 'dark' ? SUN : MOON}
        </button>
        <div className="mb-clock">{now}</div>
      </div>
    </div>
  )
}
