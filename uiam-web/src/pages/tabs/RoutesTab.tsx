/**
 * 路由：按监听器分组，组内按 sort_no 排序。
 *
 * 这里最容易被忽略的事实是**顺序即语义**——同一监听器下前面的先匹配，
 * 一条 `Prefix /` 放在前面会把后面所有规则吃掉。所以列表里把 sort_no 摆在
 * 第一列，并在有遮蔽风险时给提示（前一条是 `/` 而后一条不是）。
 */
import { useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { describeAddrs, describeMatcher, describeTo, parseJson } from '../../lib/format'
import type { Listener, Route, RoutePayload } from '../../lib/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { JsonEditor } from '../../components/JsonEditor'
import { useToast } from '../../components/Toast'
import { Badge, Empty, Field, Modal, Section, Spinner, Toggle } from '../../components/ui'
import { IconEdit, IconPlus, IconTrash } from '../../components/icons'

const MATCHER_TEMPLATES: Record<string, string> = {
  Prefix: '{"type":"Prefix","urn":["/api"]}',
  Exact: '{"type":"Exact","urn":["/health"]}',
  Host: '{"type":"Host","addr":"example.com"}',
  Regex: '{"type":"Regex","regex":"^/v[0-9]+/"}',
  Service: '{"type":"Service","svc-name":["adm-svr"]}',
  Default: '{"type":"Default"}',
}

const TO_TEMPLATES: Record<string, string> = {
  LoadBalancer: '{"type":"LoadBalancer","name":"","preserve-host":true}',
  Host: '{"type":"Host","addr":"127.0.0.1:8080","preserve-host":true}',
  Static: '{"type":"Static","spa":true}',
}

function typeOf(json: string): string {
  const parsed = parseJson(json)
  if (parsed && typeof parsed === 'object' && 'type' in parsed) {
    const t = (parsed as Record<string, unknown>).type
    if (typeof t === 'string') return t
  }
  return ''
}

interface FormState {
  listenerId: string
  sortNo: number
  name: string
  matcherJson: string
  toJson: string
  logJson: string
  enabled: boolean
}

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
  const [form, setForm] = useState<FormState>({
    listenerId: '',
    sortNo: 1,
    name: '',
    matcherJson: MATCHER_TEMPLATES.Prefix,
    toJson: TO_TEMPLATES.LoadBalancer,
    logJson: '',
    enabled: true,
  })
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<Route | null>(null)

  const grouped = useMemo(() => {
    return listeners.map((listener) => ({
      listener,
      routes: routes
        .filter((r) => r.listenerId === listener.id)
        .sort((a, b) => a.sortNo - b.sortNo || a.id.localeCompare(b.id)),
    }))
  }, [listeners, routes])

  useEffect(() => {
    if (!open) return
    if (editing) {
      setForm({
        listenerId: editing.listenerId,
        sortNo: editing.sortNo,
        name: editing.name,
        matcherJson: editing.matcherJson,
        toJson: editing.toJson,
        logJson: editing.logJson ?? '',
        enabled: editing.enabled,
      })
    }
  }, [open, editing])

  const openCreate = (listenerId: string) => {
    const siblings = routes.filter((r) => r.listenerId === listenerId)
    setEditing(null)
    setForm({
      listenerId,
      sortNo: siblings.length + 1,
      name: '',
      matcherJson: MATCHER_TEMPLATES.Prefix,
      toJson: TO_TEMPLATES.LoadBalancer,
      logJson: '',
      enabled: true,
    })
    setOpen(true)
  }

  const openEdit = (route: Route) => {
    setEditing(route)
    setOpen(true)
  }

  const save = async () => {
    const payload: RoutePayload = {
      id: editing?.id,
      listenerId: form.listenerId,
      sortNo: form.sortNo,
      name: form.name.trim(),
      matcherJson: form.matcherJson,
      toJson: form.toJson,
      logJson: form.logJson.trim() || null,
      enabled: form.enabled,
    }
    if (!payload.name) {
      toast.error('路由名称不能为空')
      return
    }
    setSaving(true)
    try {
      if (editing) await api.route.update(payload)
      else await api.route.add(payload)
      toast.success(editing ? '路由已保存' : '路由已创建')
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
                      const shadowed =
                        prev !== undefined &&
                        prev.enabled &&
                        route.enabled &&
                        describeMatcher(prev.matcherJson).startsWith('前缀 /') &&
                        !describeMatcher(route.matcherJson).startsWith('前缀 /')
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
                                  前一条是「前缀 /」，会吃掉这条
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

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        width={760}
        title={editing ? '编辑路由' : '新建路由'}
        description="matcher / to 是 gatex 的配置类型，直接写 JSON；type 区分大小写。"
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
          <div className="grid gap-3.5 sm:grid-cols-3">
            <Field label="所属监听器">
              <select
                className="select"
                value={form.listenerId}
                onChange={(e) => setForm((f) => ({ ...f, listenerId: e.target.value }))}
              >
                {listeners.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.kind === 1 ? 'HTTP' : 'TCP'} · {describeAddrs(l.addrsJson).join(',') || l.id}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="顺序" hint="小的先匹配">
              <input
                className="input"
                type="number"
                value={form.sortNo}
                onChange={(e) => setForm((f) => ({ ...f, sortNo: Number(e.target.value) }))}
              />
            </Field>
            <Field label="名称" required>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="adm 后台接口"
              />
            </Field>
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="匹配条件（matcher_json）">
              <select
                className="select mb-1.5"
                value={typeOf(form.matcherJson)}
                onChange={(e) =>
                  setForm((f) => ({ ...f, matcherJson: MATCHER_TEMPLATES[e.target.value] ?? '' }))
                }
              >
                <option value="">（自定义）</option>
                {Object.keys(MATCHER_TEMPLATES).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <JsonEditor
                value={form.matcherJson}
                onChange={(v) => setForm((f) => ({ ...f, matcherJson: v }))}
                rows={5}
              />
            </Field>
            <Field label="转发目标（to_json）">
              <select
                className="select mb-1.5"
                value={typeOf(form.toJson)}
                onChange={(e) =>
                  setForm((f) => ({ ...f, toJson: TO_TEMPLATES[e.target.value] ?? '' }))
                }
              >
                <option value="">（自定义）</option>
                {Object.keys(TO_TEMPLATES).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <JsonEditor
                value={form.toJson}
                onChange={(v) => setForm((f) => ({ ...f, toJson: v }))}
                rows={5}
              />
            </Field>
          </div>

          <Field label="日志配置（log_json）" hint="留空表示用默认（不额外记录）">
            <JsonEditor
              value={form.logJson}
              onChange={(v) => setForm((f) => ({ ...f, logJson: v }))}
              rows={3}
              placeholder='{"request":{},"response":{}}'
              templates={[
                { label: '记录请求+响应', json: '{"request":{},"response":{}}' },
                { label: '只记请求', json: '{"request":{}}' },
              ]}
            />
          </Field>

          <Toggle
            checked={form.enabled}
            onChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
            label="启用（停用的路由不参与渲染）"
          />
        </div>
      </Modal>

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
