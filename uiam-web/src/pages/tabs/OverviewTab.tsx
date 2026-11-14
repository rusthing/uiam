/**
 * 概览：这个实例「现在长什么样、上一次发的是什么」。
 *
 * 不做花哨的图表——管理面打开这一页要回答三个问题：配置由多少东西组成、
 * 最后一次发布是什么时候哪一版、还有没有什么没发出去。所以是计数 + 元信息 +
 * 最近一版，全部一屏可见。
 */
import { formatTime, relativeTime, shortChecksum } from '../../lib/format'
import type { Gateway } from '../../lib/types'
import type { GatewayTree } from '../../state/useGatewayTree'
import { Badge, Section, Stat } from '../../components/ui'
import { IconEye, IconInfo } from '../../components/icons'

export function OverviewTab({
  gateway,
  tree,
  onPreview,
}: {
  gateway: Gateway
  tree: GatewayTree
  onPreview: () => void
}) {
  const httpCount = tree.listeners.filter((l) => l.kind === 1).length
  const tcpCount = tree.listeners.filter((l) => l.kind === 2).length
  const enabledListeners = new Set(tree.listeners.filter((l) => l.enabled).map((l) => l.id))
  const activeRoutes = tree.routes.filter((r) => enabledListeners.has(r.listenerId) && r.enabled)
  const latest = tree.releases[0]
  const unpushed = tree.releases.filter((r) => !r.pushed)

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="HTTP 监听器" value={httpCount} hint={`启用 ${tree.listeners.filter((l) => l.kind === 1 && l.enabled).length}`} />
        <Stat label="TCP 监听器" value={tcpCount} hint={`启用 ${tree.listeners.filter((l) => l.kind === 2 && l.enabled).length}`} />
        <Stat label="生效路由" value={activeRoutes.length} hint={`共 ${tree.routes.length} 条`} />
        <Stat label="负载均衡器" value={tree.balancers.length} hint={`启用 ${tree.balancers.filter((b) => b.enabled).length}`} />
        <Stat label="发布版本" value={tree.releases.length} hint={unpushed.length > 0 ? `${unpushed.length} 条未推送` : '全部已推送'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Section title="实例信息" description="一个实例对应 Consul KV 里的一个键">
          <dl className="grid grid-cols-[96px_1fr] gap-y-2 px-5 py-4 text-[12.5px]">
            <dt className="text-ink-mute">实例标识</dt>
            <dd className="mono text-ink">{gateway.code}</dd>
            <dt className="text-ink-mute">展示名</dt>
            <dd className="text-ink">{gateway.name}</dd>
            <dt className="text-ink-mute">KV key</dt>
            <dd className="mono break-all text-ink">{gateway.consulKey}</dd>
            <dt className="text-ink-mute">状态</dt>
            <dd>
              {gateway.enabled ? <Badge tone="ok">启用</Badge> : <Badge tone="mute">停用</Badge>}
            </dd>
            <dt className="text-ink-mute">备注</dt>
            <dd className="text-ink-soft">{gateway.remark || '—'}</dd>
            <dt className="text-ink-mute">创建 / 更新</dt>
            <dd className="text-ink-soft">
              {formatTime(gateway.createMs)}
              <span className="mx-1.5 text-ink-mute">·</span>
              {relativeTime(gateway.updateMs)}
            </dd>
            <dt className="text-ink-mute">高级配置</dt>
            <dd className="flex flex-wrap gap-1.5">
              {gateway.extraToml && <Badge tone="brand">extra_toml</Badge>}
              {gateway.opsJson && <Badge tone="brand">ops</Badge>}
              {gateway.staticJson && <Badge tone="brand">static</Badge>}
              {gateway.upstreamErrorJson && <Badge tone="brand">upstream-error</Badge>}
              {!gateway.extraToml &&
                !gateway.opsJson &&
                !gateway.staticJson &&
                !gateway.upstreamErrorJson && <span className="text-ink-mute">全部走默认</span>}
            </dd>
          </dl>
        </Section>

        <Section
          title="最近一次发布"
          description="历史只增，线上恒等于版本号最大的那版"
          actions={
            <button className="btn btn-sm" onClick={onPreview}>
              <IconEye size={13} /> 预览当前配置
            </button>
          }
        >
          {latest ? (
            <div className="grid gap-2.5 px-5 py-4">
              <div className="flex items-center gap-2">
                <Badge tone="brand">v{latest.version}</Badge>
                {latest.pushed ? <Badge tone="ok">已推送</Badge> : <Badge tone="warn">未推送</Badge>}
                <span className="mono text-[11px] text-ink-mute">{shortChecksum(latest.checksum)}</span>
              </div>
              <p className="text-[12.5px] text-ink-soft">
                {formatTime(latest.pushedMs ?? latest.createMs)}
                <span className="mx-1.5 text-ink-mute">·</span>
                操作者 #{latest.createrId}
              </p>
              {!latest.pushed && (
                <p className="rounded-lg border border-[color-mix(in_srgb,var(--warn)_35%,transparent)] bg-warn-soft px-2.5 py-2 text-[11.5px] leading-relaxed text-ink">
                  这条记录已生成但没写进 KV——上次推送失败了。重新点发布即可，会生成新版本。
                </p>
              )}
            </div>
          ) : (
            <div className="px-5 py-6 text-center">
              <p className="text-[12.5px] text-ink-soft">还没有发布过</p>
              <p className="mt-1 text-[11.5px] text-ink-mute">
                第一次发布会把整棵配置写进 KV，网关侧随即读到。
              </p>
            </div>
          )}
        </Section>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-line bg-surface-sunken px-3.5 py-3 text-[11.5px] leading-relaxed text-ink-mute">
        <IconInfo size={14} className="mt-[2px] shrink-0" />
        <p>
          配置的生效路径是单向的：<span className="text-ink-soft">uiam 写 Consul KV → 网关读 KV</span>。
          网关不会回调 uiam，也不会读这里的数据库，所以「uiam 挂了网关照常转发」是设计约束而非巧合。
          发布后要确认是否生效，去看网关的 <span className="mono">/health</span> 里的{' '}
          <span className="mono">config-state</span>。
        </p>
      </div>
    </div>
  )
}
