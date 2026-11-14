/**
 * 系统设置：外观、操作者、桌面布局。
 *
 * 「操作者 ID」看着像个开发期临时物，但它决定审计字段 `creater_id` 落在谁头上，
 * 所以放在设置里而不是藏在某个表单里——一期没有登录，这是唯一能说明「谁改的」
 * 的东西。
 */
import { useState, useSyncExternalStore } from 'react'
import { getOperatorId, setOperatorId } from '../lib/api'
import { currentTheme, subscribeTheme, toggleTheme } from '../lib/theme'
import { APP_MAP } from './meta'
import { useToast } from '../components/Toast'
import { useShell } from '../shell/state'
import { cx } from '../components/ui'

export function SettingsApp() {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, currentTheme)
  const [operator, setOperator] = useState(getOperatorId)
  const toast = useToast()
  const shell = useShell()

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
          <div className="pane-desc">外观、操作者与桌面布局</div>
        </div>
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
        <span className="hint" style={{ margin: 0 }}>
          编辑态下可以拖动组件排序、切换尺寸、移除；布局存在本机 localStorage。
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
