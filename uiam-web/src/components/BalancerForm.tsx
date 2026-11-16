/**
 * 负载均衡器表单，从 BalancersTab 抽出来给图里的节点复用。
 *
 * 启用/停用不在这里——它挂在卡片右上角（图上直接点），表单只管「这个对象是什么」。
 */
import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { isValidJson, parseJson } from '../lib/format'
import { asBalancerPayload } from '../lib/payload'
import type { Balancer, BalancerPayload } from '../lib/types'
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

export const BALANCER_TEMPLATES: Record<string, string> = {
  Array: '{"type":"Array","update-frequency":"15s","selection-algorithm":"RoundRobin","backends":["127.0.0.1:8080"]}',
  SystemConfig: '{"type":"SystemConfig","host":"adm-svr","port":9001}',
  DNS: '{"type":"DNS","query-name":"example.com","port":443,"dns-server":"8.8.8.8"}',
  Consul: '{"type":"Consul","base-url":"http://127.0.0.1:8500","service-name":"adm-svr"}',
  Nacos: '{"type":"Nacos","base-url":"http://127.0.0.1:8848","service-name":"adm-svr"}',
  Swarm: '{"type":"Swarm","service-name":"gatex-rs_svr01","port":80}',
}

interface FormState {
  name: string
  configJson: string
  remark: string
}

function defaultForm(): FormState {
  return { name: '', configJson: BALANCER_TEMPLATES.Array, remark: '' }
}

function configType(json: string): string {
  const parsed = parseJson(json)
  if (parsed && typeof parsed === 'object' && 'type' in parsed) {
    const t = (parsed as Record<string, unknown>).type
    if (typeof t === 'string') return t
  }
  return '自定义'
}

export function BalancerForm({
  open,
  gatewayId,
  balancer,
  onClose,
  onSaved,
}: {
  open: boolean
  gatewayId: string
  /** 为空表示新建 */
  balancer?: Balancer | null
  onClose: () => void
  /** 带回保存后的实体：「新建并连上路由」要靠它拿到新 id/名字 */
  onSaved: (saved?: Balancer) => void
}) {
  const toast = useToast()
  const [form, setForm] = useState<FormState>(defaultForm)
  const [baseline, setBaseline] = useState<FormState>(defaultForm)
  const [saving, setSaving] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [reveal, setReveal] = useState(0)

  useEffect(() => {
    if (!open) return
    const next = balancer
      ? { name: balancer.name, configJson: balancer.configJson, remark: balancer.remark ?? '' }
      : defaultForm()
    setForm(next)
    setBaseline(next)
    setAttempted(false)
  }, [open, balancer])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const missing: FormIssue[] = form.name.trim()
    ? []
    : [{ text: '请填写名称（路由按它引用）', target: 'name' }]
  const jsonOk = isValidJson(form.configJson)
  const issues: FormIssue[] = [
    ...(attempted ? missing : []),
    ...(jsonOk ? [] : [{ text: '配置 JSON 语法有误', target: 'config' } as FormIssue]),
  ]
  const canSubmit = missing.length === 0 && jsonOk
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline)

  const save = async () => {
    if (saving) return
    if (!canSubmit) {
      setAttempted(true)
      setReveal((n) => n + 1)
      return
    }
    // 编辑走 asBalancerPayload 铺底：enabled 等表单里没有的字段原样带回去
    const payload: BalancerPayload = balancer
      ? {
          ...asBalancerPayload(balancer),
          name: form.name.trim(),
          configJson: form.configJson,
          remark: form.remark.trim() || null,
        }
      : {
          gatewayId,
          name: form.name.trim(),
          configJson: form.configJson,
          remark: form.remark.trim() || null,
          enabled: true,
        }
    setSaving(true)
    try {
      const saved = balancer ? await api.balancer.update(payload) : await api.balancer.add(payload)
      toast.success(balancer ? '负载均衡器已保存' : '负载均衡器已创建')
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
      width={680}
      title={balancer ? `编辑「${balancer.name}」` : '新建负载均衡器'}
      description="实例级全局 map，被路由按名字引用；config_json 是 gatex 的原生配置。"
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
        kind="负载均衡器"
        name={(balancer?.name ?? form.name) || '尚未命名'}
        meta={`类型 ${configType(form.configJson)}`}
        mono
      />

      <FormNotice>
        名字是路由引用它的键：改名后，原来按旧名字引用它的路由会变成悬空引用，发布会被拒。
      </FormNotice>

      <FormSection title="标识与类型" description="先起名字，再选类型起个模板；模板内容随时能改。">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field
            label="名称"
            required
            name="name"
            error={attempted && !form.name.trim() ? '名字不能为空' : undefined}
            hint="被路由引用；同实例内唯一"
          >
            <input
              className="input mono"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="adm-lb"
              autoFocus
            />
          </Field>
          <Field label="类型" name="type" hint="换类型会替换当前 JSON，可撤销">
            <TypeSelect
              templates={BALANCER_TEMPLATES}
              value={form.configJson}
              onChange={(v) => set('configJson', v)}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title="配置" description="gatex 的 BalancerConfig，type 区分大小写。">
        <Field label="config_json" name="config">
          <JsonEditor value={form.configJson} onChange={(v) => set('configJson', v)} rows={7} />
        </Field>
      </FormSection>

      <FormSection title="备注" description="选填，只给人看，不进渲染结果。">
        <Field label="备注" name="remark">
          <input
            className="input"
            value={form.remark}
            onChange={(e) => set('remark', e.target.value)}
            placeholder="可选，比如这组后端属于哪个服务"
          />
        </Field>
      </FormSection>
    </Modal>
  )
}
