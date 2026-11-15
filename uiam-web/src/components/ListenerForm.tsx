/**
 * 监听器表单（新建 / 编辑），从 ListenersTab 里抽出来。
 *
 * 抽出来的理由只有一个：**图和表格都要编辑同一个对象**。两处各写一份表单，
 * 迟早出现「图里能改 TLS、表里改不了」这种漂移；而且监听地址这种结构性变更的
 * 警告文案只该有一份。
 *
 * 启用/停用不在这里：它挂在卡片右上角的开关上，改了立刻生效，不必先开表单。
 */
import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { asListenerPayload } from '../lib/payload'
import type { Listener, ListenerAddr, ListenerPayload } from '../lib/types'
import { useToast } from './Toast'
import { Field, Modal } from './ui'
import { IconPlus, IconTrash } from './icons'

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
}

function fromListener(l: Listener): FormState {
  return {
    kind: l.kind,
    sortNo: l.sortNo,
    addrsJson: l.addrsJson,
    remark: l.remark ?? '',
  }
}

export function ListenerForm({
  open,
  gatewayId,
  listener,
  nextSort,
  onClose,
  onSaved,
}: {
  open: boolean
  gatewayId: string
  /** 为空表示新建 */
  listener?: Listener | null
  /** 新建时的默认顺序号 */
  nextSort: number
  onClose: () => void
  onSaved: (saved: Listener) => void
}) {
  const toast = useToast()
  const [form, setForm] = useState<FormState>({
    kind: 1,
    sortNo: nextSort,
    addrsJson: '[]',
    remark: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(
      listener ? fromListener(listener) : { kind: 1, sortNo: nextSort, addrsJson: '[]', remark: '' },
    )
  }, [open, listener, nextSort])

  const save = async () => {
    const payload: ListenerPayload = listener
      ? {
          ...asListenerPayload(listener),
          kind: form.kind,
          sortNo: form.sortNo,
          addrsJson: form.addrsJson || '[]',
          remark: form.remark.trim() || null,
        }
      : {
          gatewayId,
          kind: form.kind,
          sortNo: form.sortNo,
          addrsJson: form.addrsJson || '[]',
          remark: form.remark.trim() || null,
          enabled: true,
        }
    setSaving(true)
    try {
      const saved = listener
        ? await api.listener.update(payload)
        : await api.listener.add(payload)
      toast.success(listener ? '监听器已保存' : '监听器已创建')
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
      width={620}
      title={listener ? '编辑监听器' : '新建监听器'}
      description="监听地址在网关启动时绑定：改这里会让发布变成「需要重启」。启停在图上的卡片右上角。"
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
      </div>
    </Modal>
  )
}
