/**
 * 首页：实例总览。
 *
 * 没有实例时这里就是唯一的入口，所以空态必须给「新建」这条路径，
 * 而不是一句「暂无数据」把人晾住。
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGatewayList } from '../state/GatewayList'
import { GatewayForm } from '../components/GatewayForm'
import { Badge, Empty, Spinner, cx } from '../components/ui'
import { IconChevronRight, IconPlus, IconServer } from '../components/icons'
import { relativeTime } from '../lib/format'

export function HomePage() {
  const { gateways, loading, error, reload } = useGatewayList()
  const [formOpen, setFormOpen] = useState(false)
  const navigate = useNavigate()

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 py-5 lg:px-8 lg:py-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-ink">网关实例</h1>
          <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-ink-mute">
            每个实例对应 Consul KV 里的一个键。在这里编辑监听器 / 路由 / 负载均衡器，
            渲染成完整 TOML 后推到那个键，网关侧读到即生效。
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setFormOpen(true)}>
          <IconPlus size={13} /> 新建实例
        </button>
      </header>

      {loading && gateways.length === 0 && (
        <div className="flex items-center gap-2 py-16 text-[13px] text-ink-mute">
          <Spinner size={15} /> 加载中…
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">
          加载失败：{error.message}
          <button className="ml-2 underline" onClick={reload}>
            重试
          </button>
        </div>
      )}

      {!loading && !error && gateways.length === 0 && (
        <div className="panel">
          <Empty
            title="还没有网关实例"
            description="先建一个实例，再往里加监听器和路由。第一次发布会生成 v1 并写进 Consul KV。"
            action={
              <button className="btn btn-primary btn-sm" onClick={() => setFormOpen(true)}>
                新建第一个实例
              </button>
            }
          />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {gateways.map((gateway) => (
          <button
            key={gateway.id}
            onClick={() => navigate(`/gateway/${gateway.id}`)}
            className={cx(
              'group panel relative flex flex-col gap-2.5 p-4 text-left transition-all',
              'hover:-translate-y-0.5 hover:shadow-lg',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-[9px] border border-line bg-surface-sunken text-ink-soft">
                  <IconServer size={15} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-ink">{gateway.name}</p>
                  <p className="mono text-[11px] text-ink-mute">{gateway.code}</p>
                </div>
              </div>
              {gateway.enabled ? <Badge tone="ok">启用</Badge> : <Badge tone="mute">停用</Badge>}
            </div>

            <p className="mono truncate text-[11.5px] text-ink-soft" title={gateway.consulKey}>
              {gateway.consulKey}
            </p>

            <p className="min-h-[2.6em] text-[12px] leading-relaxed text-ink-mute">
              {gateway.remark || '未填备注'}
            </p>

            <div className="flex items-center justify-between border-t border-line pt-2.5 text-[11px] text-ink-mute">
              <span>更新于 {relativeTime(gateway.updateMs)}</span>
              <span className="flex items-center gap-0.5 text-ink-soft transition-colors group-hover:text-brand">
                进入
                <IconChevronRight size={12} />
              </span>
            </div>
          </button>
        ))}
      </div>

      <GatewayForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={(saved) => {
          reload()
          navigate(`/gateway/${saved.id}`)
        }}
      />
    </div>
  )
}
