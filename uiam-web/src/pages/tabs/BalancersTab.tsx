/**
 * 负载均衡器：实例级全局 map，被路由按名字引用。
 *
 * `name` 是被引用的键，所以它必须独立成列并有唯一约束——界面上把它放在第一列，
 * 并显示「被几条路由引用」。引用数为 0 时不是错误（渲染只给告警），但基本可以
 * 确定是写错了名字或者忘了改路由。
 */
import { useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { describeBalancer, referencedBalancer } from '../../lib/format'
import type { Balancer, BalancerPayload, Route } from '../../lib/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { JsonEditor } from '../../components/JsonEditor'
import { useToast } from '../../components/Toast'
import { Badge, Empty, Field, Modal, Section, Spinner, Toggle } from '../../components/ui'
import { IconEdit, IconPlus, IconTrash } from '../../components/icons'

const TEMPLATES: Record<string, string> = {
  Array: '{"type":"Array","update-frequency":"15s","selection-algorithm":"RoundRobin","backends":["127.0.0.1:8080"]}',
  SystemConfig: '{"type":"SystemConfig","host":"adm-svr","port":9001}',
  DNS: '{"type":"DNS","query-name":"example.com","port":443,"dns-server":"8.8.8.8"}',
  Consul: '{"type":"Consul","base-url":"http://127.0.0.1:8500","service-name":"adm-svr"}',
  Nacos: '{"type":"Nacos","base-url":"http://127.0.0.1:8848","service-name":"adm-svr"}',
  Swarm: '{"type":"Swarm","service-name":"gatex-rs_svr01","port":80}',
}

function typeOf(json: string): string {
  try {
    const parsed = JSON.parse(json)
    if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') return parsed.type
  } catch {
    // 解析失败交给 JsonEditor 提示
  }
  return ''
}

interface FormState {
  name: string
  configJson: string
  remark: string
  enabled: boolean
}

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
  const [form, setForm] = useState<FormState>({
    name: '',
    configJson: TEMPLATES.Array,
    remark: '',
    enabled: true,
  })
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<Balancer | null>(null)

  useEffect(() => {
    if (!open) return
    if (editing) {
      setForm({
        name: editing.name,
        configJson: editing.configJson,
        remark: editing.remark ?? '',
        enabled: editing.enabled,
      })
    } else {
      setForm({ name: '', configJson: TEMPLATES.Array, remark: '', enabled: true })
    }
  }, [open, editing])

  const refCount = (name: string) =>
    routes.filter((r) => referencedBalancer(r.toJson) === name).length

  const save = async () => {
    if (!form.name.trim()) {
      toast.error('名称不能为空：它是被路由引用的键')
      return
    }
    const payload: BalancerPayload = {
      id: editing?.id,
      gatewayId,
      name: form.name.trim(),
      configJson: form.configJson,
      remark: form.remark.trim() || null,
      enabled: form.enabled,
    }
    setSaving(true)
    try {
      if (editing) await api.balancer.update(payload)
      else await api.balancer.add(payload)
      toast.success(editing ? '负载均衡器已保存' : '负载均衡器已创建')
      setOpen(false)
      onChanged()
    } catch (e) {
      toast.error((e as ApiError).message)
    } finally {
      setSaving(false)
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
                  <th className="w-[70px]">状态</th>
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
                      <td>
                        <Badge tone="brand">{info.type}</Badge>
                      </td>
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
                        {balancer.enabled ? (
                          <Badge tone="ok">启用</Badge>
                        ) : (
                          <Badge tone="mute">停用</Badge>
                        )}
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

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        width={680}
        title={editing ? '编辑负载均衡器' : '新建负载均衡器'}
        description="config_json 是 gatex 的 BalancerConfig，type 区分大小写。"
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)} disabled={saving}>
              取消
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        <div className="grid gap-3.5">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="名称" required hint="被路由引用；同实例内唯一">
              <input
                className="input mono"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="adm-lb"
              />
            </Field>
            <Field label="类型">
              <select
                className="select"
                value={typeOf(form.configJson)}
                onChange={(e) => setForm((f) => ({ ...f, configJson: TEMPLATES[e.target.value] ?? '' }))}
              >
                <option value="">（自定义）</option>
                {Object.keys(TEMPLATES).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="配置（config_json）">
            <JsonEditor
              value={form.configJson}
              onChange={(v) => setForm((f) => ({ ...f, configJson: v }))}
              rows={7}
            />
          </Field>
          <Field label="备注">
            <input
              className="input"
              value={form.remark}
              onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))}
              placeholder="可选"
            />
          </Field>
          <Toggle
            checked={form.enabled}
            onChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
            label="启用（停用的不参与渲染）"
          />
        </div>
      </Modal>

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
