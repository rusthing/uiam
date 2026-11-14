/**
 * 监听器：HTTP 与 TCP 同构（都是 addrs + routes），用 kind 区分。
 *
 * 监听地址不是普通字段——它在网关启动时绑定，改动属于结构性变更，发布会要求
 * 确认重启。界面上把这个后果写在表单里，而不是等发布被拒了才说。
 */
import { useEffect, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { describeAddrs } from '../../lib/format'
import type { Listener, ListenerAddr, ListenerPayload, Route } from '../../lib/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useToast } from '../../components/Toast'
import { Badge, Empty, Field, Modal, Section, Spinner, Toggle, cx } from '../../components/ui'
import { IconEdit, IconPlus, IconTrash } from '../../components/icons'

/** 监听地址编辑器：结构化行比裸 JSON 少犯「少个逗号」的错 */
function AddrsEditor({ value, onChange }: { value: string; onChange: (json: string) => void }) {
  let rows: ListenerAddr[] = []
  try {
    const parsed = JSON.parse(value || '[]')
    if (Array.isArray(parsed)) {
      rows = parsed.map((item) =>
        typeof item === 'string' ? { addr: item } : (item as ListenerAddr),
      )
    }
  } catch {
    rows = []
  }

  const write = (next: ListenerAddr[]) => {
    const clean = next.map((r) => {
      const item: ListenerAddr = { addr: r.addr }
      if (r.tls && (r.tls.cert || r.tls.key)) item.tls = { cert: r.tls.cert, key: r.tls.key }
      return item
    })
    onChange(JSON.stringify(clean))
  }

  const patch = (index: number, next: Partial<ListenerAddr>) => {
    write(rows.map((r, i) => (i === index ? { ...r, ...next } : r)))
  }

  return (
    <div className="grid gap-2">
      {rows.length === 0 && (
        <p className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-[12px] text-ink-mute">
          还没有监听地址
        </p>
      )}
      {rows.map((row, index) => (
        <div key={index} className="rounded-xl border border-line bg-surface-sunken p-2.5">
          <div className="flex items-center gap-2">
            <input
              className="input mono !h-8"
              value={row.addr}
              placeholder="0.0.0.0:80"
              onChange={(e) => patch(index, { addr: e.target.value })}
            />
            <button
              className="btn btn-ghost btn-sm shrink-0 text-ink-mute hover:text-danger"
              onClick={() => write(rows.filter((_, i) => i !== index))}
              title="删除该地址"
            >
              <IconTrash size={13} />
            </button>
          </div>
          <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-[11.5px] text-ink-mute">
            <input
              type="checkbox"
              className="accent-[var(--brand)]"
              checked={Boolean(row.tls)}
              onChange={(e) =>
                patch(index, { tls: e.target.checked ? { cert: '', key: '' } : null })
              }
            />
            启用 TLS
          </label>
          {row.tls && (
            <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
              <input
                className="input mono !h-8 text-[11.5px]"
                value={row.tls.cert ?? ''}
                placeholder="cert/cert.pem"
                onChange={(e) => patch(index, { tls: { ...row.tls, cert: e.target.value } })}
              />
              <input
                className="input mono !h-8 text-[11.5px]"
                value={row.tls.key ?? ''}
                placeholder="cert/key.pem"
                onChange={(e) => patch(index, { tls: { ...row.tls, key: e.target.value } })}
              />
            </div>
          )}
        </div>
      ))}
      <button
        className="btn btn-sm w-fit"
        onClick={() => write([...rows, { addr: '' }])}
        type="button"
      >
        <IconPlus size={13} /> 添加地址
      </button>
    </div>
  )
}

interface FormState {
  kind: number
  sortNo: number
  addrsJson: string
  remark: string
  enabled: boolean
}

function emptyForm(nextSort: number): FormState {
  return { kind: 1, sortNo: nextSort, addrsJson: '[]', remark: '', enabled: true }
}

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
  const [editing, setEditing] = useState<Listener | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<FormState>(() => emptyForm(1))
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<Listener | null>(null)

  useEffect(() => {
    if (!open) return
    if (editing) {
      setForm({
        kind: editing.kind,
        sortNo: editing.sortNo,
        addrsJson: editing.addrsJson,
        remark: editing.remark ?? '',
        enabled: editing.enabled,
      })
    } else {
      setForm(emptyForm(listeners.length + 1))
    }
  }, [open, editing, listeners.length])

  const routeCount = (listenerId: string) => routes.filter((r) => r.listenerId === listenerId).length

  const openCreate = () => {
    setEditing(null)
    setOpen(true)
  }

  const openEdit = (listener: Listener) => {
    setEditing(listener)
    setOpen(true)
  }

  const save = async () => {
    const payload: ListenerPayload = {
      id: editing?.id,
      gatewayId,
      kind: form.kind,
      sortNo: form.sortNo,
      addrsJson: form.addrsJson || '[]',
      remark: form.remark.trim() || null,
      enabled: form.enabled,
    }
    setSaving(true)
    try {
      if (editing) await api.listener.update(payload)
      else await api.listener.add(payload)
      toast.success(editing ? '监听器已保存' : '监听器已创建')
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
      await api.listener.remove(removing.id)
      toast.success('监听器已删除')
      setRemoving(null)
      onChanged()
    } catch (e) {
      toast.error((e as ApiError).message)
    }
  }

  const addrCount = (json: string) => describeAddrs(json).length

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
                {listeners.map((listener) => (
                  <tr key={listener.id}>
                    <td className="mono text-ink-mute">{listener.sortNo}</td>
                    <td>
                      <Badge tone={listener.kind === 1 ? 'brand' : 'warn'}>
                        {listener.kind === 1 ? 'HTTP' : 'TCP'}
                      </Badge>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {describeAddrs(listener.addrsJson).map((addr, i) => (
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
                        {addrCount(listener.addrsJson) === 0 && (
                          <span className="text-[11.5px] text-danger">未配置地址</span>
                        )}
                      </div>
                    </td>
                    <td className="text-ink-soft">{routeCount(listener.id)}</td>
                    <td className="max-w-[220px] truncate text-ink-soft">{listener.remark || '—'}</td>
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        width={620}
        title={editing ? '编辑监听器' : '新建监听器'}
        description="监听地址在网关启动时绑定：改这里会让发布变成「需要重启」。"
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
            <Field label="类型" hint="HTTP 渲染进 listeners，TCP 渲染进 tcp-listeners">
              <select
                className="select"
                value={form.kind}
                onChange={(e) => setForm((f) => ({ ...f, kind: Number(e.target.value) }))}
              >
                <option value={1}>HTTP</option>
                <option value={2}>TCP</option>
              </select>
            </Field>
            <Field label="顺序" hint="同一类型内按此顺序渲染">
              <input
                className="input"
                type="number"
                value={form.sortNo}
                onChange={(e) => setForm((f) => ({ ...f, sortNo: Number(e.target.value) }))}
              />
            </Field>
          </div>
          <Field
            label="监听地址"
            required
            hint="证书只存路径，私钥不进库；文件必须存在于网关节点上。"
          >
            <AddrsEditor
              value={form.addrsJson}
              onChange={(json) => setForm((f) => ({ ...f, addrsJson: json }))}
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
            label="启用（停用的监听器不参与渲染）"
          />
        </div>
      </Modal>

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
