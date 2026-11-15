/**
 * 负载均衡器表单，从 BalancersTab 抽出来给图里的节点复用。
 *
 * 启用/停用不在这里——它挂在卡片右上角（图上直接点），表单只管「这个对象是什么」。
 */
import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { parseJson } from '../lib/format'
import { asBalancerPayload } from '../lib/payload'
import type { Balancer, BalancerPayload } from '../lib/types'
import { JsonEditor } from './JsonEditor'
import { useToast } from './Toast'
import { Field, Modal } from './ui'

export const BALANCER_TEMPLATES: Record<string, string> = {
  Array: '{"type":"Array","update-frequency":"15s","selection-algorithm":"RoundRobin","backends":["127.0.0.1:8080"]}',
  SystemConfig: '{"type":"SystemConfig","host":"adm-svr","port":9001}',
  DNS: '{"type":"DNS","query-name":"example.com","port":443,"dns-server":"8.8.8.8"}',
  Consul: '{"type":"Consul","base-url":"http://127.0.0.1:8500","service-name":"adm-svr"}',
  Nacos: '{"type":"Nacos","base-url":"http://127.0.0.1:8848","service-name":"adm-svr"}',
  Swarm: '{"type":"Swarm","service-name":"gatex-rs_svr01","port":80}',
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
  name: string
  configJson: string
  remark: string
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
  const [form, setForm] = useState<FormState>({
    name: '',
    configJson: BALANCER_TEMPLATES.Array,
    remark: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(
      balancer
        ? { name: balancer.name, configJson: balancer.configJson, remark: balancer.remark ?? '' }
        : { name: '', configJson: BALANCER_TEMPLATES.Array, remark: '' },
    )
  }, [open, balancer])

  const save = async () => {
    if (!form.name.trim()) {
      toast.error('名称不能为空：它是被路由引用的键')
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
      const saved = balancer
        ? await api.balancer.update(payload)
        : await api.balancer.add(payload)
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
      title={balancer ? '编辑负载均衡器' : '新建负载均衡器'}
      description="config_json 是 gatex 的 BalancerConfig，type 区分大小写。启停在图上的卡片右上角。"
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
              onChange={(e) =>
                setForm((f) => ({ ...f, configJson: BALANCER_TEMPLATES[e.target.value] ?? '' }))
              }
            >
              <option value="">（自定义）</option>
              {Object.keys(BALANCER_TEMPLATES).map((t) => (
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
      </div>
    </Modal>
  )
}
