/**
 * 网关实例的新建 / 编辑弹窗。
 *
 * 一个实例对应 Consul KV 里的**一个 key**，所以 `consulKey` 是这个表单里最要命的
 * 字段：写错就是「发布显示成功、网关永远读不到」。这里给了明确提示，并把
 * 「环境前缀由服务端 `[consul] key-prefix` 补」这件事写清楚，避免有人手写成
 * `dev/xxx.toml` 之后又被打一遍前缀。
 *
 * 表单按「先认对象 → 再填必填 → 最后才是高级配置」排，不把四段可选 JSON
 * 一上来摊在脸上。高级区展开后内容很长，保存栏由 Modal 固定在底部。
 */
import { useEffect, useId, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { isValidJson } from '../lib/format'
import type { Gateway, GatewayPayload } from '../lib/types'
import { useToast } from './Toast'
import {
  Field,
  FormIdentity,
  FormNotice,
  FormSection,
  Modal,
  Spinner,
  Toggle,
  cx,
  useReplacementUndo,
  type FormIssue,
} from './ui'
import { JsonEditor } from './JsonEditor'

const OPS_TEMPLATE = `{
  "health-path": "/health",
  "metrics-path": "/metrics",
  "addrs": ["0.0.0.0:9090"]
}`

const STATIC_TEMPLATE = `{
  "root-dir": "/srv/uiam-web",
  "page-404-path": "/srv/uiam-web/404.html"
}`

const UPSTREAM_TEMPLATE = `{
  "enabled": true,
  "status": 503,
  "expose-detail": true
}`

const EXTRA_TEMPLATE = `[pingora-conf]
threads = 8
grace-period-seconds = 5
graceful-shutdown-timeout-seconds = 30`

interface FormState {
  code: string
  name: string
  consulKey: string
  enabled: boolean
  remark: string
  extraToml: string
  opsJson: string
  staticJson: string
  upstreamErrorJson: string
}

function toForm(gateway?: Gateway | null): FormState {
  return {
    code: gateway?.code ?? '',
    name: gateway?.name ?? '',
    consulKey: gateway?.consulKey ?? '',
    enabled: gateway?.enabled ?? true,
    remark: gateway?.remark ?? '',
    extraToml: gateway?.extraToml ?? '',
    opsJson: gateway?.opsJson ?? '',
    staticJson: gateway?.staticJson ?? '',
    upstreamErrorJson: gateway?.upstreamErrorJson ?? '',
  }
}

export function GatewayForm({
  open,
  gateway,
  onClose,
  onSaved,
}: {
  open: boolean
  gateway?: Gateway | null
  onClose: () => void
  onSaved: (saved: Gateway) => void
}) {
  const toast = useToast()
  const [form, setForm] = useState<FormState>(() => toForm(gateway))
  const [saving, setSaving] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [reveal, setReveal] = useState(0)
  const sec = useId()
  const extraUndo = useReplacementUndo(form.extraToml)

  useEffect(() => {
    if (!open) return
    setForm(toForm(gateway))
    // 编辑已有实例时默认展开高级区——用户点编辑往往就是要改这些
    setAdvanced(Boolean(gateway))
    setAttempted(false)
  }, [open, gateway])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const missing: FormIssue[] = []
  if (!form.code.trim()) missing.push({ text: '请填写实例标识', target: 'code' })
  if (!form.name.trim()) missing.push({ text: '请填写展示名', target: 'name' })
  if (!form.consulKey.trim()) missing.push({ text: '请填写 Consul KV key', target: 'consulKey' })

  const jsonFields = [
    { key: 'ops', label: '运维端点', value: form.opsJson },
    { key: 'static', label: '静态资源', value: form.staticJson },
    { key: 'upstream', label: '上游异常', value: form.upstreamErrorJson },
  ] as const
  const jsonIssues: FormIssue[] = jsonFields
    .filter((f) => !isValidJson(f.value))
    .map((f) => ({ text: `${f.label}的 JSON 语法有误`, target: f.key }))

  const issues: FormIssue[] = [...jsonIssues, ...(attempted ? missing : [])]
  const canSubmit = missing.length === 0 && jsonIssues.length === 0
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(gateway))
  const advancedFilled = [form.extraToml, form.opsJson, form.staticJson, form.upstreamErrorJson].filter(
    (v) => v.trim(),
  ).length

  const jumpTo = (id: string) => document.getElementById(id)?.scrollIntoView({ block: 'start' })

  const submit = async () => {
    if (saving) return
    if (!canSubmit) {
      setAttempted(true)
      setReveal((n) => n + 1)
      return
    }
    const payload: GatewayPayload = {
      id: gateway?.id,
      code: form.code.trim(),
      name: form.name.trim(),
      consulKey: form.consulKey.trim(),
      enabled: form.enabled,
      remark: form.remark.trim() || null,
      extraToml: form.extraToml.trim() || null,
      opsJson: form.opsJson.trim() || null,
      staticJson: form.staticJson.trim() || null,
      upstreamErrorJson: form.upstreamErrorJson.trim() || null,
    }
    setSaving(true)
    try {
      const saved = gateway ? await api.gateway.update(payload) : await api.gateway.add(payload)
      toast.success(gateway ? `已保存「${payload.name}」` : `已创建「${payload.name}」`)
      onSaved(saved)
      onClose()
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
      width={720}
      title={gateway ? `编辑「${gateway.name}」` : '新建网关实例'}
      description="一个实例对应 Consul KV 里的一个 key，发布时把整棵子树渲染成 TOML 推到该键。"
      dirty={dirty}
      busy={saving}
      onSubmit={submit}
      revealIssues={reveal}
      issues={issues}
      progress={!attempted && missing.length > 0 ? `必填 3 项 · 还差 ${missing.length} 项` : undefined}
      footerNote="改动只落在库里，重新发布后才影响线上"
      footer={({ requestClose, busy }) => (
        <>
          <button className="btn" onClick={requestClose} disabled={busy}>
            取消
          </button>
          <button
            className={cx('btn btn-primary', !canSubmit && 'is-unready')}
            onClick={submit}
            aria-disabled={!canSubmit}
          >
            {saving ? (
              <>
                <Spinner size={12} /> 保存中…
              </>
            ) : gateway ? (
              '保存'
            ) : (
              '创建'
            )}
          </button>
        </>
      )}
    >
      <FormIdentity
        kind="网关实例"
        name={gateway?.name ?? '尚未命名'}
        meta={gateway ? `${gateway.code} · ${gateway.consulKey}` : '新建后会自动选中这个实例'}
      />

      <FormNotice tone="warn">
        KV key 只填 data_id（如 gatex-rs-svr01.toml）。写成 dev/… 会被服务端再补一次前缀，
        结果是「发布成功、网关读不到」。
      </FormNotice>

      <div className="df-jump" aria-label="表单分区">
        <button type="button" onClick={() => jumpTo(`${sec}-basic`)}>
          基本信息
        </button>
        <button
          type="button"
          onClick={() => {
            setAdvanced(true)
            requestAnimationFrame(() => jumpTo(`${sec}-advanced`))
          }}
        >
          高级配置 <span>{advancedFilled ? `${advancedFilled} 项有值` : '未配置'}</span>
        </button>
      </div>

      <FormSection
        id={`${sec}-basic`}
        title="基本信息"
        description="标识与写入位置。这三项决定这份配置能被哪个网关读到。"
      >
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="实例标识" required name="code" hint="如 svr01、svr00；与 Consul 注册名保持一致">
            <input
              className="input"
              value={form.code}
              onChange={(e) => set('code', e.target.value)}
              placeholder="svr01"
              autoFocus
            />
          </Field>
          <Field label="展示名" required name="name" hint="只影响界面显示">
            <input
              className="input"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="主网关"
            />
          </Field>
          <Field
            className="sm:col-span-2"
            label="Consul KV key"
            required
            name="consulKey"
            hint={
              <>
                环境前缀由服务端 <span className="mono">[consul] key-prefix</span> 自动补上，不要手写{' '}
                <span className="mono">dev/</span>。
              </>
            }
          >
            <input
              className="input mono"
              value={form.consulKey}
              onChange={(e) => set('consulKey', e.target.value)}
              placeholder="gatex-rs-svr01.toml"
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title="状态与备注" description="状态决定这个实例是否参与发布；备注只给人看。">
        <div className="grid gap-3.5">
          <div className="df-switch-row">
            <div>
              <p className="text-[13px] font-medium text-ink">启用</p>
              <p className="hint">停用的实例不参与发布；已有发布记录不受影响</p>
            </div>
            <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} />
          </div>
          <Field label="备注" name="remark">
            <input
              className="input"
              value={form.remark}
              onChange={(e) => set('remark', e.target.value)}
              placeholder="可选，比如这组实例由谁维护"
            />
          </Field>
        </div>
      </FormSection>

      <FormSection
        id={`${sec}-advanced`}
        title="高级配置"
        description="pingora-conf / ops / static / upstream-error。留空就用 gatex 默认值，不必一次填全。"
        actions={
          <button type="button" className="df-sec-toggle" onClick={() => setAdvanced((v) => !v)}>
            {advanced ? '收起' : '展开'}
          </button>
        }
      >
        {advanced ? (
          <div className="grid gap-4">
            <Field
              label="额外 TOML（extra_toml）"
              name="extraToml"
              hint="无法结构化的部分，如 [pingora-conf]。渲染时只补缺失的顶层键，已存在的段不覆盖（冲突进告警）。"
            >
              <textarea
                className="textarea"
                rows={6}
                spellCheck={false}
                value={form.extraToml}
                onChange={(e) => set('extraToml', e.target.value)}
                placeholder={EXTRA_TEMPLATE}
              />
            </Field>
            <div className="df-field-tools">
              <button
                type="button"
                onClick={() => extraUndo.apply(EXTRA_TEMPLATE, 'pingora-conf 示例', (v) => set('extraToml', v))}
              >
                填入示例
              </button>
              {extraUndo.replaced && (
                <div className="df-undo" role="status">
                  <span>已填入「{extraUndo.replaced.label}」</span>
                  <button type="button" onClick={() => extraUndo.undo((v) => set('extraToml', v))}>
                    撤销
                  </button>
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="运维端点（ops_json）" name="ops" hint="配了 addrs 会单开一个只跑 /health、/metrics 的监听器">
                <JsonEditor
                  value={form.opsJson}
                  onChange={(v) => set('opsJson', v)}
                  rows={6}
                  placeholder={OPS_TEMPLATE}
                  templates={[{ label: '标准三件套', json: OPS_TEMPLATE }]}
                />
              </Field>
              <Field label="静态资源（static_json）" name="static" hint="root-dir 在网关节点上必须存在">
                <JsonEditor
                  value={form.staticJson}
                  onChange={(v) => set('staticJson', v)}
                  rows={6}
                  placeholder={STATIC_TEMPLATE}
                  templates={[{ label: 'SPA 站点', json: STATIC_TEMPLATE }]}
                />
              </Field>
            </div>
            <Field label="上游异常（upstream_error_json）" name="upstream" hint="连不到后端时的响应策略，默认 503 + 错误体">
              <JsonEditor
                value={form.upstreamErrorJson}
                onChange={(v) => set('upstreamErrorJson', v)}
                rows={5}
                placeholder={UPSTREAM_TEMPLATE}
                templates={[{ label: '默认策略', json: UPSTREAM_TEMPLATE }]}
              />
            </Field>
          </div>
        ) : (
          <p className="df-sec-fold">
            {advancedFilled > 0
              ? `已有 ${advancedFilled} 段配置，展开可查看或修改；不展开也会原样保存。`
              : '这四段都是可选的，展开后按需填写。'}
          </p>
        )}
      </FormSection>
    </Modal>
  )
}
