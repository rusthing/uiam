/**
 * 监听器表单（新建 / 编辑），从 ListenersTab 里抽出来。
 *
 * 抽出来的理由只有一个：**图和表格都要编辑同一个对象**。两处各写一份表单，
 * 迟早出现「图里能改 TLS、表里改不了」这种漂移；而且监听地址这种结构性变更的
 * 警告文案只该有一份。
 *
 * 启用/停用不在这里：它挂在卡片右上角的开关上，改了立刻生效，不必先开表单。
 */
import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { describeAddrs } from '../lib/format'
import { asListenerPayload } from '../lib/payload'
import type { Listener, ListenerAddr, ListenerPayload } from '../lib/types'
import { useToast } from './Toast'
import {
  Field,
  FormIdentity,
  FormNotice,
  FormSection,
  Modal,
  Spinner,
  cx,
  type FormIssue,
} from './ui'
import { IconPlus, IconTrash } from './icons'

/** 监听地址编辑器：结构化行比裸 JSON 少犯「少个逗号」的错 */
function parseAddrs(value: string): ListenerAddr[] {
  try {
    const parsed = JSON.parse(value || '[]')
    if (Array.isArray(parsed)) {
      return parsed.map((item) =>
        typeof item === 'string' ? { addr: item } : (item as ListenerAddr),
      )
    }
  } catch {
    // 解析不了就当作空列表，用户仍可重新添加；原始值在保存前不会被写回
  }
  return []
}

/** 一行的校验结果。既是行内错误，也是保存按钮为什么不可用的原因 */
function addrProblem(row: ListenerAddr): string | undefined {
  const addr = row.addr.trim()
  if (!addr) return '地址不能为空'
  if (!/^(?:\[[^\]]+\]|[^:\s]+):\d{1,5}$/.test(addr)) {
    return '格式应为 0.0.0.0:80，域名或 IPv6 也可以'
  }
  if (row.tls) {
    if (!row.tls.cert && !row.tls.key) return '勾了 TLS 就填证书与私钥路径，或取消勾选'
    if (!row.tls.cert || !row.tls.key) return '证书路径和私钥路径要成对填写'
  }
  return undefined
}

function addrProblems(value: string): string[] {
  const rows = parseAddrs(value)
  if (rows.length === 0) return ['至少添加一个监听地址']
  return rows
    .map((row, i) => {
      const problem = addrProblem(row)
      return problem ? `第 ${i + 1} 个地址：${problem}` : undefined
    })
    .filter((v): v is string => Boolean(v))
}

function AddrsEditor({ value, onChange }: { value: string; onChange: (json: string) => void }) {
  const rows = parseAddrs(value)
  const listRef = useRef<HTMLDivElement>(null)

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

  const addRow = () => {
    const index = rows.length
    write([...rows, { addr: '' }])
    // 新行一出现就把光标放进去，别让人再点一次
    requestAnimationFrame(() =>
      listRef.current?.querySelector<HTMLInputElement>(`[data-addr-row="${index}"]`)?.focus(),
    )
  }

  return (
    <div className="grid gap-2" ref={listRef}>
      {rows.length === 0 && (
        <p className="df-empty-line">还没有监听地址，点下面的「添加地址」开始</p>
      )}
      {rows.map((row, index) => {
        const problem = addrProblem(row)
        return (
          <div key={index} className="df-addr-row">
            <div className="flex items-center gap-2">
              <span className="df-addr-n">{index + 1}</span>
              <input
                className={cx('input mono !h-8', problem && '!border-danger')}
                value={row.addr}
                placeholder="0.0.0.0:80"
                data-addr-row={index}
                aria-label={`第 ${index + 1} 个监听地址`}
                aria-invalid={Boolean(problem)}
                onChange={(e) => patch(index, { addr: e.target.value })}
              />
              <button
                className="btn btn-ghost btn-sm shrink-0 text-ink-mute hover:text-danger"
                onClick={() => write(rows.filter((_, i) => i !== index))}
                title="删除该地址"
                aria-label={`删除第 ${index + 1} 个地址`}
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
              启用 TLS（证书只存路径，私钥不进库）
            </label>
            {row.tls && (
              <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                <input
                  className="input mono !h-8 text-[11.5px]"
                  value={row.tls.cert ?? ''}
                  placeholder="cert/cert.pem"
                  aria-label={`第 ${index + 1} 个地址的证书路径`}
                  onChange={(e) => patch(index, { tls: { ...row.tls, cert: e.target.value } })}
                />
                <input
                  className="input mono !h-8 text-[11.5px]"
                  value={row.tls.key ?? ''}
                  placeholder="cert/key.pem"
                  aria-label={`第 ${index + 1} 个地址的私钥路径`}
                  onChange={(e) => patch(index, { tls: { ...row.tls, key: e.target.value } })}
                />
              </div>
            )}
            {problem && <p className="df-err">{problem}</p>}
          </div>
        )
      })}
      <button className="btn btn-sm w-fit" onClick={addRow} type="button">
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
  const [attempted, setAttempted] = useState(false)
  const [reveal, setReveal] = useState(0)
  // 基线在每次打开时定下来：nextSort / 实体对象在弹框开着时可能被外层刷新，
  // 拿它们实时算「有没有改动」会平白冒出一个「未保存」
  const [baseline, setBaseline] = useState<FormState>({
    kind: 1,
    sortNo: nextSort,
    addrsJson: '[]',
    remark: '',
  })

  useEffect(() => {
    if (!open) return
    const initial = listener
      ? fromListener(listener)
      : { kind: 1, sortNo: nextSort, addrsJson: '[]', remark: '' }
    setForm(initial)
    setBaseline(initial)
    setAttempted(false)
  }, [open, listener, nextSort])

  const problems = addrProblems(form.addrsJson)
  const canSubmit = problems.length === 0
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline)
  const issues: FormIssue[] = attempted
    ? problems.map((text) => ({ text, target: 'addrs' }))
    : []
  const knownAddrs = listener ? describeAddrs(listener.addrsJson).join(' · ') : ''

  const save = async () => {
    if (saving) return
    if (!canSubmit) {
      setAttempted(true)
      setReveal((n) => n + 1)
      return
    }
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
      const saved = listener ? await api.listener.update(payload) : await api.listener.add(payload)
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
      description="决定网关在哪些地址、用哪种协议收请求。"
      dirty={dirty}
      busy={saving}
      onSubmit={save}
      revealIssues={reveal}
      issues={issues}
      progress={!attempted && problems.length > 0 ? '必填：至少 1 个可用地址' : undefined}
      footerNote="改地址属于结构性变更，发布时会要求确认重启"
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
        kind={listener ? '监听器' : '新监听器'}
        name={listener ? knownAddrs || '未配置地址' : '尚未配置地址'}
        meta={listener ? `${listener.kind === 1 ? 'HTTP' : 'TCP'} · 顺序 ${listener.sortNo}` : `顺序 ${nextSort}`}
        mono
      />

      <FormNotice tone="warn">
        监听地址在网关启动时绑定：改这里会让下次发布变成「需要重启」。启停不在这个表单里，
        在图上的卡片右上角。
      </FormNotice>

      <FormSection
        title="监听地址"
        description="一行一个地址；勾选 TLS 后填的是网关节点上的相对路径，不是证书内容。"
      >
        <Field
          label="地址列表"
          required
          group
          name="addrs"
          error={attempted && problems.length > 0 ? `${problems.length} 处需要处理` : undefined}
          hint="证书与私钥文件必须真实存在于网关节点上。"
        >
          <AddrsEditor
            value={form.addrsJson}
            onChange={(json) => setForm((f) => ({ ...f, addrsJson: json }))}
          />
        </Field>
      </FormSection>

      <FormSection title="类型与顺序" description="同一类型内按此顺序渲染。">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="类型" name="kind" hint="HTTP 渲染进 listeners，TCP 渲染进 tcp-listeners">
            <select
              className="select"
              value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: Number(e.target.value) }))}
            >
              <option value={1}>HTTP</option>
              <option value={2}>TCP</option>
            </select>
          </Field>
          <Field label="顺序" name="sortNo" hint="同一类型内按此顺序渲染">
            <input
              className="input"
              type="number"
              min={1}
              value={form.sortNo}
              onChange={(e) => setForm((f) => ({ ...f, sortNo: Number(e.target.value) }))}
            />
          </Field>
          <Field className="sm:col-span-2" label="备注" name="remark">
            <input
              className="input"
              value={form.remark}
              onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))}
              placeholder="可选，比如这组地址给谁用"
            />
          </Field>
        </div>
      </FormSection>
    </Modal>
  )
}
