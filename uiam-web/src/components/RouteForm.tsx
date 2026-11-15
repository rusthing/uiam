/**
 * 路由表单（新建 / 编辑），从 RoutesTab 里抽出来给拓扑图复用。
 *
 * `matcher_json` / `to_json` 是 gatex 的配置类型，这里不把它们拆成「可视化条件构造器」——
 * 一期类型有 5 种 matcher、3 种 to，做表单化会把 gatex 的 schema 复制一份到前端，
 * 那边加字段这边就漏。保留 JSON 编辑 + 模板下拉，是刻意的取舍。
 */
import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { describeAddrs, parseJson } from '../lib/format'
import type { Listener, Route, RoutePayload } from '../lib/types'
import { JsonEditor } from './JsonEditor'
import { useToast } from './Toast'
import { Field, Modal, Toggle } from './ui'

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

export function RouteForm({
  open,
  listeners,
  routes,
  route,
  presetListenerId,
  onClose,
  onSaved,
}: {
  open: boolean
  listeners: Listener[]
  routes: Route[]
  /** 为空表示新建 */
  route?: Route | null
  /** 新建时默认挂到哪个监听器（从拓扑图的泳道里点「+ 路由」进来） */
  presetListenerId?: string
  onClose: () => void
  onSaved: (saved: Route) => void
}) {
  const toast = useToast()
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

  useEffect(() => {
    if (!open) return
    if (route) {
      setForm({
        listenerId: route.listenerId,
        sortNo: route.sortNo,
        name: route.name,
        matcherJson: route.matcherJson,
        toJson: route.toJson,
        logJson: route.logJson ?? '',
        enabled: route.enabled,
      })
      return
    }
    const listenerId = presetListenerId ?? listeners[0]?.id ?? ''
    const siblings = routes.filter((r) => r.listenerId === listenerId)
    setForm({
      listenerId,
      sortNo: siblings.length + 1,
      name: '',
      matcherJson: MATCHER_TEMPLATES.Prefix,
      toJson: TO_TEMPLATES.LoadBalancer,
      logJson: '',
      enabled: true,
    })
  }, [open, route, presetListenerId, listeners, routes])

  const save = async () => {
    const payload: RoutePayload = {
      id: route?.id,
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
      const saved = route ? await api.route.update(payload) : await api.route.add(payload)
      toast.success(route ? '路由已保存' : '路由已创建')
      onClose()
      onSaved(saved)
    } catch (e) {
      toast.error((e as ApiError).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={760}
      title={route ? '编辑路由' : '新建路由'}
      description="matcher / to 是 gatex 的配置类型，直接写 JSON；type 区分大小写。"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>
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
  )
}
