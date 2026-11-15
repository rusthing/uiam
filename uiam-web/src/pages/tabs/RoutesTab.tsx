/**
 * 路由表：按监听器分组，组内按 sort_no 排序。
 *
 * 这里最容易被忽略的事实是**顺序即语义**——同一监听器下前面的先匹配，
 * 一条 `Prefix /` 放在前面会把后面所有规则吃掉。所以列表里把 sort_no 摆在
 * 第一列，并用 `shadowedBy` 判断「上一条是否真的覆盖了这条的路径」。
 *
 * 想更直观地改顺序请用拓扑图（同一个 tab 的「图形」视图），它把顺序画成纵向位置；
 * 这个表格保留下来，是因为十几条路由横着扫比看图快。
 */
import { useMemo, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { describeAddrs, describeMatcher, describeTo, shadowedBy } from '../../lib/format'
import type { Listener, Route } from '../../lib/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { RouteForm } from '../../components/RouteForm'
import { useToast } from '../../components/Toast'
import { Badge, Empty, Section, Spinner } from '../../components/ui'
import { IconEdit, IconPlus, IconTrash } from '../../components/icons'

export function RoutesTab({
  listeners,
  routes,
  loading,
  onChanged,
}: {
  listeners: Listener[]
  routes: Route[]
  loading: boolean
  onChanged: () => void
}) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Route | null>(null)
  const [presetListenerId, setPresetListenerId] = useState<string | undefined>(undefined)
  const [removing, setRemoving] = useState<Route | null>(null)

  const grouped = useMemo(() => {
    return listeners.map((listener) => ({
      listener,
      routes: routes
        .filter((r) => r.listenerId === listener.id)
        .sort((a, b) => a.sortNo - b.sortNo || a.id.localeCompare(b.id)),
    }))
  }, [listeners, routes])

  const openCreate = (listenerId: string) => {
    setEditing(null)
    setPresetListenerId(listenerId)
    setOpen(true)
  }

  const openEdit = (route: Route) => {
    setEditing(route)
    setPresetListenerId(undefined)
    setOpen(true)
  }

  const remove = async () => {
    if (!removing) return
    try {
      await api.route.remove(removing.id)
      toast.success('路由已删除')
      setRemoving(null)
      onChanged()
    } catch (e) {
      toast.error((e as ApiError).message)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-1 py-10 text-[13px] text-ink-mute">
        <Spinner size={14} /> 加载中…
      </div>
    )
  }

  if (listeners.length === 0) {
    return (
      <Empty
        title="先建监听器，再建路由"
        description="路由挂在监听器下：渲染时按 listener_id 分组，写进对应监听器的 routes 数组。"
      />
    )
  }

  return (
    <>
      <div className="grid gap-4">
        {grouped.map(({ listener, routes: rows }) => (
          <Section
            key={listener.id}
            title={
              <span className="flex items-center gap-2">
                <Badge tone={listener.kind === 1 ? 'brand' : 'warn'}>
                  {listener.kind === 1 ? 'HTTP' : 'TCP'}
                </Badge>
                <span className="mono text-[12px] text-ink-soft">
                  {describeAddrs(listener.addrsJson).join(' · ') || '未配置地址'}
                </span>
                {!listener.enabled && <Badge tone="mute">监听器已停用</Badge>}
              </span>
            }
            description={`${rows.length} 条路由，按顺序匹配，先命中先生效`}
            actions={
              <button className="btn btn-sm" onClick={() => openCreate(listener.id)}>
                <IconPlus size={13} /> 新建路由
              </button>
            }
          >
            {rows.length === 0 ? (
              <p className="px-5 py-6 text-center text-[12.5px] text-ink-mute">
                该监听器下还没有路由，所有请求会落到 404。
              </p>
            ) : (
              <div className="table-wrap m-4">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th className="w-[54px]">顺序</th>
                      <th className="w-[140px]">名称</th>
                      <th>匹配条件</th>
                      <th>转发目标</th>
                      <th className="w-[70px]">状态</th>
                      <th className="w-[86px] text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((route, index) => {
                      const prev = index > 0 ? rows[index - 1] : undefined
                      const shadowed = Boolean(
                        prev &&
                          prev.enabled &&
                          route.enabled &&
                          shadowedBy(prev.matcherJson, route.matcherJson),
                      )
                      return (
                        <tr key={route.id}>
                          <td className="mono text-ink-mute">{route.sortNo}</td>
                          <td className="font-medium text-ink">{route.name}</td>
                          <td>
                            <div className="flex flex-col gap-0.5">
                              <span className="mono text-[11.5px] text-ink-soft">
                                {describeMatcher(route.matcherJson)}
                              </span>
                              {shadowed && (
                                <span className="text-[11px] text-warn">
                                  上一条「{describeMatcher(prev?.matcherJson)}」会吃掉这条
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="mono text-[11.5px] text-ink-soft">
                            {describeTo(route.toJson)}
                          </td>
                          <td>
                            {route.enabled ? (
                              <Badge tone="ok">启用</Badge>
                            ) : (
                              <Badge tone="mute">停用</Badge>
                            )}
                          </td>
                          <td>
                            <div className="flex justify-end gap-1">
                              <button
                                className="btn btn-ghost btn-sm !px-1.5"
                                onClick={() => openEdit(route)}
                                title="编辑"
                              >
                                <IconEdit size={13} />
                              </button>
                              <button
                                className="btn btn-ghost btn-sm !px-1.5 text-ink-mute hover:text-danger"
                                onClick={() => setRemoving(route)}
                                title="删除"
                              >
                                <IconTrash size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        ))}
      </div>

      <RouteForm
        open={open}
        listeners={listeners}
        routes={routes}
        route={editing}
        presetListenerId={presetListenerId}
        onClose={() => setOpen(false)}
        onSaved={onChanged}
      />

      <ConfirmDialog
        open={Boolean(removing)}
        title="删除路由"
        danger
        confirmText="删除"
        description={
          <>
            将删除路由 <b>{removing?.name}</b>。删除后需要重新发布才会影响线上。
          </>
        }
        onCancel={() => setRemoving(null)}
        onConfirm={remove}
      />
    </>
  )
}
