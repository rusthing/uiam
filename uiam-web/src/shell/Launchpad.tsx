/**
 * 启动台：全屏毛玻璃 + 搜索 + 6 列网格。
 *
 * 搜索匹配名字和描述两处——「发布」这个词不在应用名里，但在「网关配置」的描述里，
 * 按描述匹配能让「我想发布配置」这种意图也能搜到。
 */
import { useEffect, useRef, useState } from 'react'
import { APPS } from '../apps/meta'
import { AppTile } from '../apps/AppTile'
import { cx } from '../components/ui'
import { useShell } from './state'

export function Launchpad() {
  const shell = useShell()
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (shell.launchpad) {
      setQ('')
      // 打开就聚焦，键盘直接可搜（Esc 在 Desktop 里统一处理）
      window.setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [shell.launchpad])

  const kw = q.trim().toLowerCase()
  const list = APPS.filter(
    (a) =>
      !kw ||
      a.name.toLowerCase().includes(kw) ||
      a.desc.toLowerCase().includes(kw) ||
      a.id.includes(kw),
  )

  return (
    <div
      className={cx('launchpad', shell.launchpad && 'show')}
      onClick={(e) => {
        if (e.target === e.currentTarget) shell.setLaunchpad(false)
      }}
    >
      <input
        ref={inputRef}
        className="lp-search"
        placeholder="搜索"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="lp-grid">
        {list.map((a) => (
          <button
            key={a.id}
            className="lp-app"
            onClick={() => {
              shell.openApp(a.id)
              shell.setLaunchpad(false)
            }}
            title={a.desc}
          >
            <AppTile id={a.id} />
            <span>{a.name}</span>
          </button>
        ))}
        {list.length === 0 && (
          <div
            style={{
              color: 'rgba(255,255,255,.7)',
              fontSize: 13,
              gridColumn: '1 / -1',
              textAlign: 'center',
              padding: 30,
            }}
          >
            没有匹配的应用
          </div>
        )}
      </div>
    </div>
  )
}
