/**
 * 监听器表：HTTP 与 TCP 同构（都是 addrs + routes），用 kind 区分。
 *
 * 监听地址不是普通字段——它在网关启动时绑定，改动属于结构性变更，发布会要求
 * 确认重启。这个后果写在表单里（ListenerForm），而不是等发布被拒了才说。
 *
 * 表单已抽到 `components/ListenerForm`：拓扑图里也能改监听器，两处各写一份迟早漂移。
 */
import { useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { describeAddrs } from '../../lib/format'
import type { Listener, Route } from '../../lib/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ListenerForm } from '../../components/ListenerForm'
import { useToast } from '../../components/Toast'
import { Badge, Empty, Section, Spinner, cx } from '../../components/ui'
import { IconEdit, IconPlus, IconTrash } from '../../components/icons'

export function ListenersTab({
  gatewayId,
  listeners,
  routes,
  loading,
  onChanged,
}: {
  gatewayId: string
  listeners: Listener[]
  routes: Route[]
  loading: boolean
  onChanged: () => void
}) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Listener | null>(null)
  const [removing, setRemoving] = useState<Listener | null>(null)

  const routeCount = (listenerId: string) => routes.filter((r) => r.listenerId === listenerId).length

  const openCreate = () => {
    setEditing(null)
    setOpen(true)
  }

  const openEdit = (listener: Listener) => {
    setEditing(listener)
    setOpen(true)
  }

  const remove = async () => {
    if (!removing) return
    try {
      await api.listener.remove(removing.id)
      toast.success('监听器已删除')
      setRemoving(null)
      onChanged()
    } catch (e) {
      toast.error((e as ApiError).message)
    }
  }

  return (
    <>
      <Section
        title="监听器"
        description="HTTP 与 TCP 同构，kind 决定渲染进 listeners 还是 tcp-listeners。顺序即语义。"
        actions={
          <button className="btn btn-primary btn-sm" onClick={openCreate}>
            <IconPlus size={13} /> 新建监听器
          </button>
        }
      >
        {loading ? (
          <div className="flex items-center gap-2 px-5 py-10 text-[13px] text-ink-mute">
            <Spinner size={14} /> 加载中…
          </div>
        ) : listeners.length === 0 ? (
          <Empty
            title="还没有监听器"
            description="没有监听器时渲染出的配置里 listeners 为空数组，网关不会监听任何端口。"
            action={
              <button className="btn btn-primary btn-sm" onClick={openCreate}>
                新建第一个监听器
              </button>
            }
          />
        ) : (
          <div className="table-wrap m-4">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="w-[60px]">顺序</th>
                  <th className="w-[86px]">类型</th>
                  <th>监听地址</th>
                  <th className="w-[76px]">路由</th>
                  <th>备注</th>
                  <th className="w-[76px]">状态</th>
                  <th className="w-[96px] text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {listeners.map((listener) => {
                  const addrs = describeAddrs(listener.addrsJson)
                  return (
                    <tr key={listener.id}>
                      <td className="mono text-ink-mute">{listener.sortNo}</td>
                      <td>
                        <Badge tone={listener.kind === 1 ? 'brand' : 'warn'}>
                          {listener.kind === 1 ? 'HTTP' : 'TCP'}
                        </Badge>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {addrs.map((addr, i) => (
                            <span
                              key={i}
                              className={cx(
                                'mono rounded-md border px-1.5 py-0.5 text-[11.5px]',
                                addr.endsWith('tls')
                                  ? 'border-[color-mix(in_srgb,var(--ok)_35%,transparent)] bg-ok-soft text-ok'
                                  : 'border-line bg-surface-sunken text-ink-soft',
                              )}
                            >
                              {addr}
                            </span>
                          ))}
                          {addrs.length === 0 && (
                            <span className="text-[11.5px] text-danger">未配置地址</span>
                          )}
                        </div>
                      </td>
                      <td className="text-ink-soft">{routeCount(listener.id)}</td>
                      <td className="max-w-[220px] truncate text-ink-soft">
                        {listener.remark || '—'}
                      </td>
                      <td>
                        {listener.enabled ? (
                          <Badge tone="ok">启用</Badge>
                        ) : (
                          <Badge tone="mute">停用</Badge>
                        )}
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <button
                            className="btn btn-ghost btn-sm !px-1.5"
                            onClick={() => openEdit(listener)}
                            title="编辑"
                          >
                            <IconEdit size={13} />
                          </button>
                          <button
                            className="btn btn-ghost btn-sm !px-1.5 text-ink-mute hover:text-danger"
                            onClick={() => setRemoving(listener)}
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

      <ListenerForm
        open={open}
        gatewayId={gatewayId}
        listener={editing}
        nextSort={listeners.length + 1}
        onClose={() => setOpen(false)}
        onSaved={onChanged}
      />

      <ConfirmDialog
        open={Boolean(removing)}
        title="删除监听器"
        danger
        confirmText="删除"
        description={
          <>
            将删除监听器{' '}
            <span className="mono">
              {removing ? describeAddrs(removing.addrsJson).join(', ') || `#${removing.id}` : ''}
            </span>
            ，其下 <b>{removing ? routeCount(removing.id) : 0}</b> 条路由会一并删除（外键级联）。
            删除后需要重新发布才会影响线上。
          </>
        }
        onCancel={() => setRemoving(null)}
        onConfirm={remove}
      />
    </>
  )
}
