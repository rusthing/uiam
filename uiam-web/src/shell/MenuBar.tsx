/**
 * 菜单栏：左边是品牌与固定菜单，右边是「编辑桌面」、外观图标、状态图标与时钟。
 *
 * 外观图标就是主题切换的**动画圆心**——`toggleTheme(el)` 需要拿到它的 DOM 节点，
 * 所以这里用 ref 而不是让主题模块自己 `querySelector`。菜单项只保留三个真正有
 * 行为入口的（窗口 → 启动台、帮助 → 关于），其余是桌面观感的一部分，点了不做事
 * 比点了弹「功能未实现」更诚实。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { APP_MAP } from '../apps/meta'
import { currentTheme, subscribeTheme, toggleTheme } from '../lib/theme'
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

export function MenuBar() {
  const shell = useShell()
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, currentTheme)
  const themeRef = useRef<HTMLButtonElement>(null)
  const [now, setNow] = useState(clockText)

  useEffect(() => {
    const t = window.setInterval(() => setNow(clockText()), 20000)
    return () => window.clearInterval(t)
  }, [])

  const appName = shell.focusId ? (APP_MAP[shell.focusId]?.name ?? '访达') : '访达'

  return (
    <div className="menubar">
      <div className="mb-left">
        <div className="mb-logo">
          <svg width="13" height="15" viewBox="0 0 14 16" fill="currentColor" style={{ opacity: 0.96 }}>
            <path d="M11.28 8.5c0-1.72 1.4-2.54 1.47-2.58-.8-1.17-2.05-1.33-2.5-1.35-1.06-.11-2.07.63-2.6.63-.54 0-1.37-.62-2.25-.6-1.16.02-2.23.67-2.83 1.71-1.2 2.09-.31 5.19.87 6.89.57.83 1.26 1.76 2.16 1.73.87-.04 1.2-.56 2.25-.56s1.35.56 2.27.54c.94-.02 1.53-.85 2.1-1.69.66-.97.94-1.91.95-1.96-.02-.01-1.81-.7-1.83-2.76zM9.53 3.19c.48-.58.8-1.39.71-2.19-.69.03-1.53.46-2.02 1.04-.44.51-.83 1.33-.73 2.12.77.06 1.56-.39 2.04-.97z" />
          </svg>
        </div>
        <div className="mb-item app-name">{appName}</div>
        <div className="mb-item">文件</div>
        <div className="mb-item">编辑</div>
        <div className="mb-item">显示</div>
        <div className="mb-item">前往</div>
        <div className="mb-item" onClick={() => shell.setLaunchpad(!shell.launchpad)}>
          窗口
        </div>
        <div className="mb-item" onClick={() => shell.openApp('about')}>
          帮助
        </div>
      </div>

      <div className="mb-right">
        <div
          className={`mb-status mb-act${shell.editing ? ' on' : ''}`}
          onClick={() => shell.setEditing(!shell.editing)}
          title={shell.editing ? '退出编辑（Esc）' : '编辑桌面上的组件'}
        >
          {shell.editing ? '完成' : '编辑桌面'}
        </div>
        <button
          ref={themeRef}
          className="mb-status"
          onClick={() => toggleTheme(themeRef.current)}
          title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
          aria-label="切换外观"
          style={{ border: 'none', background: 'none', color: 'inherit', font: 'inherit' }}
        >
          {theme === 'dark' ? SUN : MOON}
        </button>
        <div className="mb-status">
          <svg width="15" height="12" viewBox="0 0 16 12" fill="currentColor">
            <path d="M8 10.6a1.1 1.1 0 1 0 0-2.2 1.1 1.1 0 0 0 0 2.2zM8 6.2c.95 0 1.84.36 2.5.95l1.06-1.13A5.3 5.3 0 0 0 8 4.45c-1.37 0-2.64.5-3.56 1.34l1.06 1.13c.66-.59 1.55-.95 2.5-.95zM8 1.9c1.83 0 3.5.7 4.75 1.85l1.07-1.13A8.4 8.4 0 0 0 8 .2a8.4 8.4 0 0 0-5.82 2.42l1.07 1.13A6.65 6.65 0 0 1 8 1.9z" />
          </svg>
        </div>
        <div className="mb-status">
          <svg width="22" height="11" viewBox="0 0 24 12" fill="none">
            <rect x=".6" y=".6" width="19" height="10.8" rx="3" stroke="currentColor" strokeOpacity=".55" />
            <rect x="2.2" y="2.2" width="14" height="7.6" rx="1.8" fill="currentColor" />
            <path d="M21.4 4.2v3.6c.8-.3 1.3-1 1.3-1.8s-.5-1.5-1.3-1.8z" fill="currentColor" fillOpacity=".55" />
          </svg>
        </div>
        <div className="mb-status">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4.3" stroke="currentColor" strokeWidth="1.3" />
            <path d="M9.2 9.2l3.3 3.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </div>
        <div className="mb-clock">{now}</div>
      </div>
    </div>
  )
}
