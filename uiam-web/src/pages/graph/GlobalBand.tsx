/**
 * 图底部的「全局」带：不挂在任何链路上的顶层配置。
 *
 * 线上 TOML 除了 listeners / routes / balancers，还有 `[static]`、`[upstream-error]`、
 * `[ops]`、`[pingora-conf]` 以及 `extra_toml` 的其余段。它们对整个实例生效，
 * 画进链路里反而会误导（会以为只对某条路由生效），所以单列一条横带。
 */
import { shortChecksum } from '../../lib/format'
import type { Gateway } from '../../lib/types'
import { cx } from '../../components/ui'
import { globalSections } from './global'
import type { Selection } from './GatewayGraph'

export function GlobalBand({
  gateway,
  selected,
  onSelect,
  published,
}: {
  gateway: Gateway
  selected: Selection | null
  onSelect: (sel: Selection) => void
  published?: { version: number; checksum: string }
}) {
  const sections = globalSections(gateway)
  const ignoredCount = sections.reduce((n, s) => n + (s.ignored?.length ?? 0), 0)

  return (
    <section className="gg-global">
      <header className="gg-global-h">
        <span className="gg-global-t">全局 · 对整个实例生效</span>
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
        <span className="gg-global-note">点一块看字段，改它走右上「编辑」</span>
      </header>

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
    </section>
  )
}
