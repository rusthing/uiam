/**
 * 网关实例的新建 / 编辑弹窗。
 *
 * 一个实例对应 Consul KV 里的**一个 key**，所以 `consulKey` 是这个表单里最要命的
 * 字段：写错就是「发布显示成功、网关永远读不到」。这里给了明确提示，并把
 * 「环境前缀由服务端 `[consul] key-prefix` 补」这件事写清楚，避免有人手写成
 * `dev/xxx.toml` 之后又被打一遍前缀。
 */
import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { isValidJson } from '../lib/format'
import type { Gateway, GatewayPayload } from '../lib/types'
import { useToast } from './Toast'
import { Field, Modal, Toggle } from './ui'
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

  useEffect(() => {
    if (!open) return
    setForm(toForm(gateway))
    // 编辑已有实例时默认展开高级区——用户点编辑往往就是要改这些
    setAdvanced(Boolean(gateway))
  }, [open, gateway])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const jsonOk =
    isValidJson(form.opsJson) &&
    isValidJson(form.staticJson) &&
    isValidJson(form.upstreamErrorJson)

  const canSubmit =
    form.code.trim() !== '' &&
    form.name.trim() !== '' &&
    form.consulKey.trim() !== '' &&
    jsonOk &&
    !saving

  const submit = async () => {
    if (!canSubmit) return
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
      const saved = gateway
        ? await api.gateway.update(payload)
        : await api.gateway.add(payload)
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
      title={gateway ? '编辑网关实例' : '新建网关实例'}
      description="一个实例对应 Consul KV 里的一个 key：发布时把这棵子树渲染成完整 TOML 推到该键。"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!canSubmit}>
            {saving ? '保存中…' : gateway ? '保存' : '创建'}
          </button>
        </>
      }
    >
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="实例标识" required hint="如 svr01、svr00；与 Consul 注册名保持一致">
          <input
            className="input"
            value={form.code}
            onChange={(e) => set('code', e.target.value)}
            placeholder="svr01"
            autoFocus
          />
        </Field>
        <Field label="展示名" required hint="只影响界面显示">
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
          hint={
            <>
              填 <span className="mono">data_id</span> 即可（如{' '}
              <span className="mono">gatex-rs-svr01.toml</span>）。环境前缀由服务端{' '}
              <span className="mono">[consul] key-prefix</span> 自动补上，不要手写{' '}
              <span className="mono">dev/</span>，否则会变成{' '}
              <span className="mono">dev/dev/…</span>。
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
        <Field className="sm:col-span-2" label="备注">
          <input
            className="input"
            value={form.remark}
            onChange={(e) => set('remark', e.target.value)}
            placeholder="可选"
          />
        </Field>
        <div className="sm:col-span-2 flex items-center justify-between rounded-xl border border-line bg-surface-sunken px-3.5 py-2.5">
          <div>
            <p className="text-[13px] font-medium text-ink">启用</p>
            <p className="hint">停用的实例不参与发布；已有发布记录不受影响</p>
          </div>
          <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} />
        </div>
      </div>

      <button
        className="mt-4 flex w-full items-center gap-1.5 border-t border-line pt-3 text-left text-[12.5px] font-medium text-ink-soft transition-colors hover:text-ink"
        onClick={() => setAdvanced((v) => !v)}
      >
        <span className={`transition-transform ${advanced ? 'rotate-90' : ''}`}>›</span>
        高级配置
        <span className="font-normal text-ink-mute">
          （pingora-conf / ops / static / upstream-error）
        </span>
      </button>

      {advanced && (
        <div className="mt-3 grid gap-4">
          <Field
            label="额外 TOML（extra_toml）"
            hint="无法结构化的部分，如 [pingora-conf]。渲染时与结构化字段合并：只补缺失的顶层键，已存在的段不覆盖（冲突进告警）。"
          >
            <div className="relative">
              <textarea
                className="textarea"
                rows={6}
                spellCheck={false}
                value={form.extraToml}
                onChange={(e) => set('extraToml', e.target.value)}
                placeholder={EXTRA_TEMPLATE}
              />
              <button
                className="absolute bottom-1.5 right-2 rounded-md px-1.5 py-0.5 text-[11px] text-ink-mute hover:bg-surface-hover hover:text-ink"
                onClick={() => set('extraToml', EXTRA_TEMPLATE)}
              >
                填入示例
              </button>
            </div>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="运维端点（ops_json）" hint="配了 addrs 会单开一个只跑 /health、/metrics 的监听器">
              <JsonEditor
                value={form.opsJson}
                onChange={(v) => set('opsJson', v)}
                rows={6}
                placeholder={OPS_TEMPLATE}
                templates={[{ label: '标准三件套', json: OPS_TEMPLATE }]}
              />
            </Field>
            <Field label="静态资源（static_json）" hint="root-dir 在网关节点上必须存在">
              <JsonEditor
                value={form.staticJson}
                onChange={(v) => set('staticJson', v)}
                rows={6}
                placeholder={STATIC_TEMPLATE}
                templates={[{ label: 'SPA 站点', json: STATIC_TEMPLATE }]}
              />
            </Field>
          </div>
          <Field label="上游异常（upstream_error_json）" hint="连不到后端时的响应策略，默认 503 + 错误体">
            <JsonEditor
              value={form.upstreamErrorJson}
              onChange={(v) => set('upstreamErrorJson', v)}
              rows={5}
              placeholder={UPSTREAM_TEMPLATE}
              templates={[{ label: '默认策略', json: UPSTREAM_TEMPLATE }]}
            />
          </Field>
        </div>
      )}
    </Modal>
  )
}
