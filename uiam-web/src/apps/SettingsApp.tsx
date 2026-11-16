/**
 * 系统设置：外观、操作者、桌面布局。
 *
 * 「操作者 ID」看着像个开发期临时物，但它决定审计字段 `creater_id` 落在谁头上，
 * 所以放在设置里而不是藏在某个表单里——一期没有登录，这是唯一能说明「谁改的」
 * 的东西。
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { getOperatorId, setOperatorId } from '../lib/api'
import { currentTheme, subscribeTheme, toggleTheme } from '../lib/theme'
import {
  resetSiteConfig,
  setSiteConfig,
  SITE_ICONS,
  useSiteConfig,
} from '../lib/site'
import { APP_MAP } from './meta'
import { useToast } from '../components/Toast'
import { useShell } from '../shell/state'
import {
  resetAppearance,
  setAppearance,
  useAppearance,
  type WidgetDim,
  type WidgetStyle,
} from '../shell/widgetAppearance'
import { preferencesBackend, readPref, subscribePrefs } from '../lib/preferences'
import { cx } from '../components/ui'

export function SettingsApp() {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, currentTheme)
  const appearance = useAppearance()
  const backend = preferencesBackend()
  const site = useSiteConfig()
  const [operator, setOperator] = useState(getOperatorId)
  const [iconUrl, setIconUrl] = useState('')
  const [freeMode, setFreeMode] = useState(
    () => readPref<{ free?: boolean } | null>('uiam-desktop', null)?.free === true,
  )
  const toast = useToast()

  useEffect(
    () =>
      subscribePrefs(() => {
        setFreeMode(readPref<{ free?: boolean } | null>('uiam-desktop', null)?.free === true)
      }),
    [],
  )
  const shell = useShell()
  const iconIsPreset = Boolean(SITE_ICONS[site.icon])

  const commitOperator = (value: string) => {
    setOperator(value)
    const trimmed = value.trim()
    if (trimmed) setOperatorId(trimmed)
  }

  const resetLayout = () => {
    // 布局状态在 Desktop 里（组件级），用一个自定义事件通知它重置——
    // 为这一件事把整份布局提到全局 store 里不划算
    window.dispatchEvent(new CustomEvent('uiam-reset-desktop'))
    toast.success('桌面布局已恢复默认')
  }

  return (
    <div className="pane">
      <div className="pane-head">
        <div>
          <div className="pane-title">系统设置</div>
          <div className="pane-desc">站点身份、外观、操作者与桌面布局</div>
        </div>
      </div>

      <div className="sec-label">站点</div>
      <div className="field" style={{ maxWidth: 420 }}>
        <label className="label" htmlFor="site-name">
          站点标题
        </label>
        <input
          id="site-name"
          className="input"
          value={site.name}
          maxLength={40}
          onChange={(e) => setSiteConfig({ name: e.target.value })}
          placeholder="显示在顶栏与浏览器标签上"
        />
        <label className="label" style={{ marginTop: 12 }}>
          站点图标
        </label>
        <div className="site-icons">
          {Object.entries(SITE_ICONS).map(([id, meta]) => (
            <button
              key={id}
              className={cx('site-icon-btn', site.icon === id && 'on')}
              onClick={() => {
                setIconUrl('')
                setSiteConfig({ icon: id })
              }}
              title={meta.label}
              aria-label={`图标：${meta.label}`}
              aria-pressed={site.icon === id}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d={meta.path} />
              </svg>
              <span>{meta.label}</span>
            </button>
          ))}
        </div>
        <input
          className="input"
          style={{ marginTop: 8 }}
          value={iconIsPreset ? iconUrl : site.icon}
          onChange={(e) => {
            setIconUrl(e.target.value)
            if (e.target.value.trim()) setSiteConfig({ icon: e.target.value.trim() })
          }}
          placeholder="或填图片 URL / 站点相对路径"
          aria-label="自定义站点图标地址"
        />
        <p className="hint" style={{ marginTop: 4 }}>
          部署默认值来自 <span className="mono">VITE_SITE_NAME</span> /{' '}
          <span className="mono">VITE_SITE_ICON</span>；这里改会覆盖，并同步浏览器标签标题与
          favicon。
        </p>
        <button
          className="btn btn-sm"
          style={{ marginTop: 8 }}
          onClick={() => {
            setIconUrl('')
            resetSiteConfig()
            toast.success('站点身份已恢复默认')
          }}
        >
          恢复默认站点
        </button>
      </div>

      <div className="sec-label">外观</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="seg" style={{ marginBottom: 0 }}>
          <button
            className={cx('seg-item', theme === 'light' && 'on')}
            onClick={(e) => {
              if (theme !== 'light') toggleTheme(e.currentTarget)
            }}
          >
            浅色
          </button>
          <button
            className={cx('seg-item', theme === 'dark' && 'on')}
            onClick={(e) => {
              if (theme !== 'dark') toggleTheme(e.currentTarget)
            }}
          >
            深色
          </button>
        </div>
        <span className="hint" style={{ margin: 0 }}>
          只有两态，点菜单栏的外观图标也是直接切，没有「跟随系统」第三档。
        </span>
      </div>

      <div className="sec-label">桌面组件外观</div>
      <div className="appearance-grid">
        <div className="field">
          <label className="label">图标与小组件样式</label>
          <div className="seg" style={{ marginBottom: 0 }}>
            {(
              [
                ['default', '默认'],
                ['clear', '透明'],
                ['tinted', '色调'],
              ] as [WidgetStyle, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                className={cx('seg-item', appearance.style === value && 'on')}
                onClick={() => setAppearance({ style: value })}
                aria-pressed={appearance.style === value}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 4 }}>
            透明 / 色调会去掉彩色底纹，内容按 primary、accent 两组统一染白或染色。
          </p>
        </div>
        <div className="field">
          <label className="label">调暗桌面小组件</label>
          <div className="seg" style={{ marginBottom: 0 }}>
            {(
              [
                ['auto', '自动'],
                ['always', '始终'],
                ['never', '永不'],
              ] as [WidgetDim, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                className={cx('seg-item', appearance.dim === value && 'on')}
                onClick={() => setAppearance({ dim: value })}
                aria-pressed={appearance.dim === value}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 4 }}>
            自动：有窗口盖住桌面时转单色，让组件退到背景里。
          </p>
        </div>
      </div>

      <div className="field" style={{ maxWidth: 420, marginTop: 10 }}>
        {/* 方向与 macOS「外观 → Liquid Glass」一致：左 Clear、右 Tinted。
            滑块 value 就是 1 - glass，所以读数必须显示「不透明度」才和滑块位置同向 */}
        <label className="label" htmlFor="glass-range">
          Liquid Glass · 不透明度 {Math.round((1 - appearance.glass) * 100)}%
        </label>
        <input
          id="glass-range"
          className="range"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={1 - appearance.glass}
          onChange={(e) => setAppearance({ glass: 1 - Number(e.target.value) })}
          aria-label="Liquid Glass 不透明度"
          aria-valuetext={`${Math.round((1 - appearance.glass) * 100)}% 不透明`}
        />
        <div className="range-ends">
          <span>更清晰（透明）</span>
          <span>更不透明（着色）</span>
        </div>
        <p className="hint" style={{ marginTop: 4 }}>
          一个值全局统一：Dock、菜单栏、窗口装饰、桌面组件共用同一档；材质是静态合成，
          不启用 <span className="mono">backdrop-filter</span>。
        </p>
      </div>

      {appearance.style === 'tinted' && (
        <div className="field" style={{ maxWidth: 220, marginTop: 8 }}>
          <label className="label" htmlFor="wg-tint">
            色调
          </label>
          <input
            id="wg-tint"
            className="input"
            type="color"
            value={appearance.tint}
            onChange={(e) => setAppearance({ tint: e.target.value })}
          />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
        <button className="btn btn-sm" onClick={() => resetAppearance()}>
          恢复默认外观
        </button>
        <span className="hint" style={{ margin: 0 }}>
          偏好存于 {backend.label}
          {backend.kind === 'local' && '（后端暂无偏好接口，配 VITE_PREFERENCES_URL 可切换）'}。
        </span>
      </div>

      <div className="sec-label">操作者</div>
      <div className="field" style={{ maxWidth: 340 }}>
        <label className="label">操作者 ID</label>
        <input
          className="input"
          value={operator}
          inputMode="numeric"
          onChange={(e) => commitOperator(e.target.value)}
        />
        <p className="hint" style={{ marginTop: 4 }}>
          写接口必带 <span className="mono">X-User-Id</span>，服务端把它记进
          <span className="mono"> creater_id / updater_id</span>。一期没有登录，
          所以这里是人工填的数字。
        </p>
      </div>

      <div className="sec-label">桌面</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-sm" onClick={() => shell.setEditing(!shell.editing)}>
          {shell.editing ? '完成编辑' : '编辑桌面'}
        </button>
        <button className="btn btn-sm" onClick={resetLayout}>
          恢复默认布局
        </button>
        <label className="switch-row">
          <input
            type="checkbox"
            checked={freeMode}
            onChange={(e) => {
              setFreeMode(e.target.checked)
              window.dispatchEvent(new CustomEvent('uiam-set-free', { detail: e.target.checked }))
            }}
          />
          自由摆放（拖动时吸附网格）
        </label>
        <span className="hint" style={{ margin: 0 }}>
          编辑态下可拖动组件、点右下手柄改尺寸、点左上「−」移除；关掉自由摆放时拖的是顺序。
          布局存于 {backend.label}。
        </span>
      </div>

      <div className="sec-label">窗口</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {shell.wins.length === 0 && <span className="hint">当前没有打开的窗口</span>}
        {shell.wins.map((w) => (
          <button key={w.id} className="btn btn-sm" onClick={() => shell.focusWin(w.id)}>
            聚焦 {APP_MAP[w.id]?.name ?? w.id}
          </button>
        ))}
        {shell.wins.length > 0 && (
          <button
            className="btn btn-sm"
            onClick={() => shell.wins.forEach((w) => shell.closeWin(w.id))}
          >
            全部关闭
          </button>
        )}
      </div>
    </div>
  )
}
