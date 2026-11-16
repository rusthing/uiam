/**
 * 路由表单（新建 / 编辑），从 RoutesTab 里抽出来给拓扑图复用。
 *
 * `matcher_json` / `to_json` 是 gatex 的配置类型，这里不把它们拆成「可视化条件构造器」——
 * 一期类型有 5 种 matcher、3 种 to，做表单化会把 gatex 的 schema 复制一份到前端，
 * 那边加字段这边就漏。保留 JSON 编辑 + 模板下拉，是刻意的取舍。
 *
 * 所以「人性化」做在别处：先看清改的是哪条路由、类型模板换错了能撤销、
 * JSON 写坏当场说清哪一处、保存按钮永远在视野里。
 */
import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { describeAddrs, isValidJson } from '../lib/format'
import { asRoutePayload } from '../lib/payload'
import type { Listener, Route, RoutePayload } from '../lib/types'
import { JsonEditor } from './JsonEditor'
import { useToast } from './Toast'
import {
  Field,
  FormIdentity,
  FormNotice,
  FormSection,
  Modal,
  Spinner,
  TypeSelect,
  cx,
  type FormIssue,
} from './ui'

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

interface FormState {
  listenerId: string
  sortNo: number
  name: string
  matcherJson: string
  toJson: string
  logJson: string
}

function defaultForm(listenerId: string, sortNo: number): FormState {
  return {
    listenerId,
    sortNo,
    name: '',
    matcherJson: MATCHER_TEMPLATES.Prefix,
    toJson: TO_TEMPLATES.LoadBalancer,
    logJson: '',
  }
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
  const [form, setForm] = useState<FormState>(() => defaultForm('', 1))
  const [baseline, setBaseline] = useState<FormState>(() => defaultForm('', 1))
  const [saving, setSaving] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [reveal, setReveal] = useState(0)

  useEffect(() => {
    if (!open) return
    const next = route
      ? {
          listenerId: route.listenerId,
          sortNo: route.sortNo,
          name: route.name,
          matcherJson: route.matcherJson,
          toJson: route.toJson,
          logJson: route.logJson ?? '',
        }
      : (() => {
          const listenerId = presetListenerId ?? listeners[0]?.id ?? ''
          const siblings = routes.filter((r) => r.listenerId === listenerId)
          return defaultForm(listenerId, siblings.length + 1)
        })()
    setForm(next)
    setBaseline(next)
    setAttempted(false)
  }, [open, route, presetListenerId, listeners, routes])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const noListener = listeners.length === 0
  const missing: FormIssue[] = form.name.trim()
    ? []
    : [{ text: '请填写路由名称', target: 'name' }]
  const jsonFields = [
    { key: 'matcher', label: '匹配条件', value: form.matcherJson },
    { key: 'to', label: '转发目标', value: form.toJson },
    { key: 'log', label: '日志配置', value: form.logJson },
  ] as const
  const jsonIssues: FormIssue[] = jsonFields
    .filter((f) => !isValidJson(f.value))
    .map((f) => ({ text: `${f.label}的 JSON 语法有误`, target: f.key }))

  const issues: FormIssue[] = [
    ...jsonIssues,
    ...(attempted ? missing : []),
    ...(noListener ? [{ text: '这个实例还没有监听器，先建一个再挂路由' }] : []),
  ]
  const canSubmit = missing.length === 0 && jsonIssues.length === 0 && !noListener
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline)
  const listener = listeners.find((l) => l.id === (route?.listenerId ?? form.listenerId))
  const listenerLabel = listener
    ? `${listener.kind === 1 ? 'HTTP' : 'TCP'} · ${describeAddrs(listener.addrsJson).join(',') || listener.id}`
    : '未选择监听器'

  const save = async () => {
    if (saving) return
    if (!canSubmit) {
      setAttempted(true)
      setReveal((n) => n + 1)
      return
    }
    // 编辑走 asRoutePayload 铺底：enabled 这类表单里没有的字段原样带回去
    const payload: RoutePayload = route
      ? {
          ...asRoutePayload(route),
          listenerId: form.listenerId,
          sortNo: form.sortNo,
          name: form.name.trim(),
          matcherJson: form.matcherJson,
          toJson: form.toJson,
          logJson: form.logJson.trim() || null,
        }
      : {
          listenerId: form.listenerId,
          sortNo: form.sortNo,
          name: form.name.trim(),
          matcherJson: form.matcherJson,
          toJson: form.toJson,
          logJson: form.logJson.trim() || null,
          enabled: true,
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
      title={route ? `编辑路由「${route.name}」` : '新建路由'}
      description="按顺序匹配，命中即停；matcher / to 是 gatex 的原生 JSON。"
      dirty={dirty}
      busy={saving}
      onSubmit={save}
      revealIssues={reveal}
      issues={issues}
      progress={!attempted && missing.length > 0 ? '必填 1 项 · 还差 1 项' : undefined}
      footerNote="改动只落在库里，重新发布后才影响线上"
      footer={({ requestClose, busy }) => (
        <>
          <button className="btn" onClick={requestClose} disabled={busy}>
            取消
          </button>
          <button
            className={cx('btn btn-primary', !canSubmit && 'is-unready')}
            onClick={save}
            aria-disabled={!canSubmit}
          >
            {saving ? (
              <>
                <Spinner size={12} /> 保存中…
              </>
            ) : (
              '保存'
            )}
          </button>
        </>
      )}
    >
      <FormIdentity
        kind="路由"
        name={(route?.name ?? form.name) || '尚未命名'}
        meta={`${listenerLabel} · 顺序 ${form.sortNo}`}
      />

      <FormNotice>
        type 区分大小写；选类型会换成对应模板、可以撤销。启停不在这里，在图上的卡片右上角。
      </FormNotice>
      {noListener && (
        <FormNotice tone="warn">
          这个实例还没有监听器。路由必须挂在监听器下，先关掉这个弹框建一个监听器。
        </FormNotice>
      )}

      <FormSection title="归属与顺序" description="同一监听器下，顺序小的先匹配。">
        <div className="grid gap-3.5 sm:grid-cols-3">
          <Field label="所属监听器" name="listenerId">
            <select
              className="select"
              value={form.listenerId}
              onChange={(e) => set('listenerId', e.target.value)}
            >
              {listeners.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.kind === 1 ? 'HTTP' : 'TCP'} · {describeAddrs(l.addrsJson).join(',') || l.id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="顺序" name="sortNo" hint="小的先匹配，命中即停">
            <input
              className="input"
              type="number"
              min={1}
              value={form.sortNo}
              onChange={(e) => set('sortNo', Number(e.target.value))}
            />
          </Field>
          <Field
            label="名称"
            required
            name="name"
            error={attempted && !form.name.trim() ? '给这条路由起个能认出来的名字' : undefined}
          >
            <input
              className="input"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="adm 后台接口"
              autoFocus
            />
          </Field>
        </div>
      </FormSection>

      <FormSection
        title="匹配与转发"
        description="先用类型模板起个头，再按实际路径和后端改字段；两段都是 gatex 的原生 JSON。"
      >
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div className="grid gap-2">
            <Field label="匹配类型" name="matcherType" hint="换模板会替换当前 JSON，可撤销">
              <TypeSelect
                templates={MATCHER_TEMPLATES}
                value={form.matcherJson}
                onChange={(v) => set('matcherJson', v)}
              />
            </Field>
            <Field label="匹配条件（matcher_json）" name="matcher">
              <JsonEditor value={form.matcherJson} onChange={(v) => set('matcherJson', v)} rows={5} />
            </Field>
          </div>
          <div className="grid gap-2">
            <Field label="目标类型" name="toType" hint="换模板会替换当前 JSON，可撤销">
              <TypeSelect
                templates={TO_TEMPLATES}
                value={form.toJson}
                onChange={(v) => set('toJson', v)}
              />
            </Field>
            <Field label="转发目标（to_json）" name="to">
              <JsonEditor value={form.toJson} onChange={(v) => set('toJson', v)} rows={5} />
            </Field>
          </div>
        </div>
      </FormSection>

      <FormSection title="日志（可选）" description="留空表示用默认（不额外记录）。">
        <Field label="日志配置（log_json）" name="log">
          <JsonEditor
            value={form.logJson}
            onChange={(v) => set('logJson', v)}
            rows={3}
            placeholder='{"request":{},"response":{}}'
            templates={[
              { label: '记录请求+响应', json: '{"request":{},"response":{}}' },
              { label: '只记请求', json: '{"request":{}}' },
            ]}
          />
        </Field>
      </FormSection>
    </Modal>
  )
}
