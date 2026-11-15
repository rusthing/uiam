/**
 * 负载均衡器：实例级全局 map，被路由按名字引用。
 *
 * `name` 是被引用的键，所以它必须独立成列；「被几条路由引用」比任何状态图标都重要——
 * 引用数为 0 不是错误（渲染只给告警），但基本可以确定是写错了名字或者忘了改路由。
 *
 * 启停在状态列的开关上，不在表单里。表单已抽到 `components/BalancerForm`，
 * 图里的节点也用同一个。
 */
import { useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { describeBalancer, referencedBalancer } from '../../lib/format'
import { asBalancerPayload } from '../../lib/payload'
import type { Balancer, Route } from '../../lib/types'
import { BalancerForm } from '../../components/BalancerForm'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Switch } from '../../components/Switch'
import { useToast } from '../../components/Toast'
import { Empty, Section, Spinner } from '../../components/ui'
import { IconEdit, IconPlus, IconTrash } from '../../components/icons'

export function BalancersTab({
  gatewayId,
  balancers,
  routes,
  loading,
  onChanged,
}: {
  gatewayId: string
  balancers: Balancer[]
  routes: Route[]
  loading: boolean
  onChanged: () => void
}) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Balancer | null>(null)
  const [removing, setRemoving] = useState<Balancer | null>(null)

  const refCount = (name: string) =>
    routes.filter((r) => referencedBalancer(r.toJson) === name).length

  const toggle = async (balancer: Balancer) => {
    try {
      await api.balancer.update({ ...asBalancerPayload(balancer), enabled: !balancer.enabled })
      onChanged()
    } catch (e) {
      toast.error((e as ApiError).message)
    }
  }

  const remove = async () => {
    if (!removing) return
    try {
      await api.balancer.remove(removing.id)
      toast.success('负载均衡器已删除')
      setRemoving(null)
      onChanged()
    } catch (e) {
      toast.error((e as ApiError).message)
    }
  }

  return (
    <>
      <Section
        title="负载均衡器"
        description="实例级全局 map，被路由的 to.type = LoadBalancer 按名字引用。增删或改配置都需要重启网关。"
        actions={
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setEditing(null)
              setOpen(true)
            }}
          >
            <IconPlus size={13} /> 新建
          </button>
        }
      >
        {loading ? (
          <div className="flex items-center gap-2 px-5 py-10 text-[13px] text-ink-mute">
            <Spinner size={14} /> 加载中…
          </div>
        ) : balancers.length === 0 ? (
          <Empty
            title="还没有负载均衡器"
            description="路由可以直接指向 Host；需要多后端或服务发现时再来建一个。"
          />
        ) : (
          <div className="table-wrap m-4">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="w-[150px]">名称</th>
                  <th className="w-[110px]">类型</th>
                  <th>后端 / 服务</th>
                  <th className="w-[80px]">引用</th>
                  <th className="w-[76px]">状态</th>
                  <th className="w-[86px] text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {balancers.map((balancer) => {
                  const info = describeBalancer(balancer.configJson)
                  const used = refCount(balancer.name)
                  return (
                    <tr key={balancer.id}>
                      <td className="mono font-medium text-ink">{balancer.name}</td>
                      <td>{info.type}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {info.backends.length === 0 ? (
                            <span className="text-[11.5px] text-ink-mute">—</span>
                          ) : (
                            info.backends.slice(0, 4).map((b, i) => (
                              <span
                                key={i}
                                className="mono rounded-md border border-line bg-surface-sunken px-1.5 py-0.5 text-[11.5px] text-ink-soft"
                              >
                                {b}
                              </span>
                            ))
                          )}
                          {info.backends.length > 4 && (
                            <span className="text-[11.5px] text-ink-mute">
                              +{info.backends.length - 4}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        {used > 0 ? (
                          <span className="text-ink-soft">{used}</span>
                        ) : (
                          <span className="text-[11.5px] text-warn" title="渲染时会给出告警">
                            未被引用
                          </span>
                        )}
                      </td>
                      <td>
                        <Switch
                          on={balancer.enabled}
                          onChange={() => void toggle(balancer)}
                          label={`启用 ${balancer.name}`}
                        />
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <button
                            className="btn btn-ghost btn-sm !px-1.5"
                            onClick={() => {
                              setEditing(balancer)
                              setOpen(true)
                            }}
                            title="编辑"
                          >
                            <IconEdit size={13} />
                          </button>
                          <button
                            className="btn btn-ghost btn-sm !px-1.5 text-ink-mute hover:text-danger"
                            onClick={() => setRemoving(balancer)}
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

      <BalancerForm
        open={open}
        gatewayId={gatewayId}
        balancer={editing}
        onClose={() => setOpen(false)}
        onSaved={onChanged}
      />

      <ConfirmDialog
        open={Boolean(removing)}
        title="删除负载均衡器"
        danger
        confirmText="删除"
        description={
          <>
            将删除 <b className="mono">{removing?.name}</b>。
            若有路由仍在引用它，发布时会因为「负载均衡器不存在」被拒绝——
            这是有意的：宁可发不出去，也不要推一份网关装不起来的配置。
          </>
        }
        onCancel={() => setRemoving(null)}
        onConfirm={remove}
      />
    </>
  )
}
