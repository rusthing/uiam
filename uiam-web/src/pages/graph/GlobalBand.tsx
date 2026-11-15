/**
 * 图底部的「全局」带：不挂在任何链路上的顶层配置。
 *
 * 线上 TOML 除了 listeners / routes / balancers，还有 `[static]`、`[upstream-error]`、
 * `[ops]`、`[pingora-conf]` 以及 `extra_toml` 的其余段。它们对整个实例生效，
 * 画进链路里反而会误导（会以为只对某条路由生效），所以单列一条横带。
 *
 * 它现在是**图区底部的常驻条**（不在图的滚动区里），所以能一直看得见；
 * 但也因此要能收起来——图很高的时候，一条常驻横带就是白占一屏。
 */
import { useState } from 'react'
import { shortChecksum } from '../../lib/format'
import type { Gateway } from '../../lib/types'
import { IconChevronDown, IconEdit } from '../../components/icons'
import { cx } from '../../components/ui'
import { globalSections } from './global'
import type { Selection } from './GatewayGraph'

const OPEN_KEY = 'uiam-global-open'

export function GlobalBand({
  gateway,
  selected,
  onSelect,
  onEdit,
  published,
}: {
  gateway: Gateway
  selected: Selection | null
  onSelect: (sel: Selection) => void
  onEdit: () => void
  published?: { version: number; checksum: string }
}) {
  const sections = globalSections(gateway)
  const ignoredCount = sections.reduce((n, s) => n + (s.ignored?.length ?? 0), 0)
  // 收起状态记在本地：这是「我习惯怎么看」，不是配置
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) !== '0')

  const toggle = () => {
    const next = !open
    setOpen(next)
    localStorage.setItem(OPEN_KEY, next ? '1' : '0')
  }

  return (
    <section className={cx('gg-global', !open && 'closed')}>
      <header className="gg-global-h">
        <button
          className="gg-global-tg"
          onClick={toggle}
          title={open ? '收起全局配置' : '展开全局配置'}
          aria-expanded={open}
        >
          <IconChevronDown size={12} className={cx('gg-rot', !open && 'up')} />
          <span className="gg-global-t">全局 · 对整个实例生效</span>
        </button>
        {published && (
          <span className="gg-live" title={`已发布内容的 sha256 = ${published.checksum}`}>
            <i />
            线上 v{published.version} · {shortChecksum(published.checksum)}
          </span>
        )}
        {ignoredCount > 0 && (
          <span className="gg-global-warn" title="库里写了 gatex 不认识的键，渲染时会被忽略">
            {ignoredCount} 个键不生效
          </span>
        )}
        <span className="gg-global-note">点一块看字段</span>
        <button className="gg-global-edit" onClick={onEdit} title="编辑实例高级配置">
          <IconEdit size={11} /> 编辑
        </button>
      </header>

      {open && (
        <div className="gg-global-grid">
          {sections.map((s) => (
            <button
              key={s.key}
              className={cx(
                'gg-gcard',
                s.tone,
                selected?.kind === 'global' && selected.key === s.key && 'on',
              )}
              onClick={() => onSelect({ kind: 'global', key: s.key })}
              title={s.note}
            >
              <div className="gg-gcard-t">
                <span className="gg-gcard-title">{s.title}</span>
                {s.tone === 'neutral' && <span className="gg-gcard-badge">重启</span>}
              </div>
              <div className="gg-gcard-s mono">{s.sub}</div>
              <div className="gg-gcard-n">{s.rows.length} 个字段</div>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
