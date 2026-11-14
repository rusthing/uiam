/**
 * 外壳：左侧实例导航 + 右侧内容区。
 *
 * 侧边栏承担两件事：**切换实例**（这是管理面最频繁的动作）和**放置全局设置**
 * （操作者 ID、主题）。没有做成顶部导航，是因为实例数量会随环境增长，
 * 竖排列表比横向 tab 更能容纳。
 */
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { getOperatorId, setOperatorId } from '../lib/api'
import { useGatewayList } from '../state/GatewayList'
import { GatewayForm } from './GatewayForm'
import { ThemeToggle } from './ThemeToggle'
import { Badge, cx, Spinner } from './ui'
import { IconPlus, IconServer } from './icons'

export function Shell() {
  const { gateways, loading, error, reload } = useGatewayList()
  const [formOpen, setFormOpen] = useState(false)
  const [operator, setOperator] = useState(getOperatorId())
  const navigate = useNavigate()

  useEffect(() => {
    setOperator(getOperatorId())
  }, [])

  const commitOperator = (value: string) => {
    setOperator(value)
    const trimmed = value.trim()
    if (trimmed) setOperatorId(trimmed)
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="glass z-20 flex shrink-0 flex-col gap-3 border-b px-3 py-3 lg:sticky lg:top-0 lg:h-screen lg:w-[276px] lg:gap-4 lg:border-b-0 lg:border-r lg:px-4 lg:py-5">
        {/* 品牌 */}
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2.5">
            <span
              className="grid h-8 w-8 place-items-center rounded-[10px] text-[13px] font-bold text-white shadow-sm"
              style={{
                background: 'linear-gradient(140deg, var(--brand), color-mix(in srgb, var(--brand) 55%, #10b981))',
              }}
            >
              U
            </span>
            <div className="leading-tight">
              <p className="text-[14px] font-semibold tracking-tight text-ink">uiam</p>
              <p className="text-[11px] text-ink-mute">网关管理面</p>
            </div>
          </div>
          <div className="lg:hidden">
            <ThemeToggle compact />
          </div>
        </div>

        {/* 实例列表 */}
        <div className="flex items-center justify-between px-1 lg:mt-1">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-mute">
            网关实例
            {gateways.length > 0 && (
              <span className="ml-1.5 font-normal normal-case tracking-normal">
                {gateways.length}
              </span>
            )}
          </h2>
          <button
            className="btn btn-ghost btn-sm !h-6 !px-1.5 text-ink-mute hover:text-ink"
            onClick={() => setFormOpen(true)}
            title="新建网关实例"
          >
            <IconPlus size={14} />
          </button>
        </div>

        <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-1 lg:overflow-y-auto lg:overflow-x-hidden lg:px-0 lg:pb-0">
          {loading && gateways.length === 0 && (
            <div className="flex items-center gap-2 px-2 py-2 text-[12px] text-ink-mute">
              <Spinner size={13} /> 加载中…
            </div>
          )}
          {error && (
            <div className="px-2 py-2 text-[12px] text-danger">
              列表加载失败
              <button className="ml-1 underline" onClick={reload}>
                重试
              </button>
            </div>
          )}
          {!loading && !error && gateways.length === 0 && (
            <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center lg:mt-1">
              <IconServer size={18} className="mx-auto mb-1.5 text-ink-mute" />
              <p className="text-[12px] text-ink-mute">还没有网关实例</p>
              <button className="mt-1.5 text-[12px] text-brand hover:underline" onClick={() => setFormOpen(true)}>
                新建一个
              </button>
            </div>
          )}
          {gateways.map((g) => (
            <NavLink
              key={g.id}
              to={`/gateway/${g.id}`}
              className={({ isActive }) =>
                cx(
                  'group relative flex min-w-[188px] shrink-0 items-center gap-2 rounded-[10px] px-2.5 py-2 transition-colors lg:min-w-0',
                  isActive
                    ? 'bg-brand-soft text-ink'
                    : 'text-ink-soft hover:bg-surface-hover hover:text-ink',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cx(
                      'h-1.5 w-1.5 shrink-0 rounded-full transition-colors',
                      g.enabled ? 'bg-ok' : 'bg-ink-mute',
                    )}
                    title={g.enabled ? '已启用' : '已停用'}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{g.name}</span>
                    <span className="mono block truncate text-[10.5px] text-ink-mute">
                      {g.code} · {g.consulKey}
                    </span>
                  </span>
                  {!g.enabled && <Badge tone="mute">停用</Badge>}
                  {isActive && (
                    <span className="absolute -left-1 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-brand" />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* 底部：操作者 + 主题 */}
        <div className="hidden shrink-0 flex-col gap-2 border-t border-line pt-3 lg:flex">
          <div className="flex items-center justify-between gap-2">
            <span
              className="text-[11.5px] text-ink-mute"
              title="写接口必带 X-User-Id，审计落在 release.creater_id"
            >
              操作者 ID
            </span>
            <div className="flex items-center gap-2">
              <input
                className="input !h-7 !w-[76px] !px-2 text-center text-[12px]"
                value={operator}
                onChange={(e) => commitOperator(e.target.value)}
                inputMode="numeric"
              />
              <ThemeToggle />
            </div>
          </div>
          <p className="text-[10.5px] leading-relaxed text-ink-mute">
            一期没有登录，写接口靠这个头记操作者。
          </p>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <Outlet />
      </main>

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
