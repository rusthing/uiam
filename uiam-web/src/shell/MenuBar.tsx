/**
 * 顶栏：左边是**站点自己的**图标与标题，右边是真正有行为的入口。
 *
 * 这里曾经是苹果 logo +「访达」+ 文件/编辑/显示/前往/窗口/帮助 的仿 macOS 菜单，
 * 其中五项点了没有任何反应；右侧还挂着 wifi / 电池 / 搜索三个装饰图标。这是统一
 * 身份认证平台的桌面，不是 Mac 桌面模拟器，就把「点了不做事」的东西全部拿掉：
 * 品牌区改成可配置的站点身份，右侧只留编辑桌面、外观切换和时钟。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { currentTheme, subscribeTheme, toggleTheme } from '../lib/theme'
import {
  currentDesktopFullscreen,
  subscribeDesktopFullscreen,
  toggleDesktopFullscreen,
} from '../lib/fullscreen'
import { useToast } from '../components/Toast'
import { useAuth } from '../lib/auth-context'
import { siteIconPath, useSiteConfig } from '../lib/site'
import { cx } from '../components/ui'
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

const EXPAND = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M10 10 4 4M4 4h6M4 4v6" />
    <path d="M14 14l6 6M20 20h-6M20 20v-6" />
  </svg>
)

const COLLAPSE = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 4 11 11M11 11H5M11 11V5" />
    <path d="M20 20 13 13M13 13h6M13 13v6" />
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

/** 顶栏右上角的账户菜单：唯一承载用户信息与个人操作的地方 */
function AccountMenu() {
  const { session, logout } = useAuth()
  const shell = useShell()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const displayName = session?.nickName || session?.name || '账号'

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const openProfile = () => {
    setOpen(false)
    // 个人中心 / 改口令在后台管理（adm）里，定位到它的 /profile；窗口已开则直接抬前
    shell.openApp('adm', '/profile')
  }

  const doLogout = async () => {
    if (busy) return
    setBusy(true)
    try {
      await logout()
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-account" ref={rootRef}>
      <button
        className={`mb-status mb-user${open ? ' on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={`当前登录：${displayName}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="mb-avatar">{(displayName || 'U').slice(0, 1).toUpperCase()}</span>
        <span className="mb-user-name">{displayName}</span>
        <IconCaret />
      </button>

      {open && (
        <div className="mb-account-pop" role="menu">
          <div className="mb-account-head">
            <span className="mb-avatar lg">{(displayName || 'U').slice(0, 1).toUpperCase()}</span>
            <span className="mb-account-id">
              <strong>{displayName}</strong>
              <small>用户 ID {session?.userId ?? '—'}</small>
            </span>
          </div>
          <div className="mb-account-sep" />
          <button className="mb-account-item" role="menuitem" onClick={openProfile}>
            <IconUser /> 个人中心 / 修改口令
          </button>
          <div className="mb-account-sep" />
          <button
            className="mb-account-item danger"
            role="menuitem"
            onClick={() => void doLogout()}
            disabled={busy}
            aria-busy={busy}
          >
            <IconPower /> {busy ? '正在退出…' : '退出登录'}
          </button>
        </div>
      )}
    </div>
  )
}

function IconCaret() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}
function IconUser() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  )
}
function IconPower() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M12 3v9" />
      <path d="M7.5 6.5a7 7 0 1 0 9 0" />
    </svg>
  )
}

export function MenuBar() {
  const shell = useShell()
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, currentTheme)
  const full = useSyncExternalStore(
    subscribeDesktopFullscreen,
    currentDesktopFullscreen,
    currentDesktopFullscreen,
  )
  const toast = useToast()
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
        <button
          className={cx('mb-status', full && 'on')}
          onClick={() => {
            // 整页全屏，不是窗口最大化；这台浏览器不给就直说，别让按钮点了没反应
            if (!toggleDesktopFullscreen()) {
              toast.error('这台浏览器不允许网页全屏，可用系统全屏快捷键（⌃⌘F 或 F11）')
            }
          }}
          title={full ? '退出全屏（Esc）' : '全屏显示桌面'}
          aria-label={full ? '退出全屏' : '全屏显示桌面'}
          aria-pressed={full}
        >
          {full ? COLLAPSE : EXPAND}
        </button>
        <AccountMenu />
        <div className="mb-clock">{now}</div>
      </div>
    </div>
  )
}
