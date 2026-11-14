/**
 * 确认弹窗：删除、回滚这类不可撤销动作都走它。
 *
 * `requireCheck` 用来做「必须明确表态」的闸门——发布/回滚会重启网关时，
 * 光点「确定」太轻了，勾一个复选框才能按下去。
 */
import { useEffect, useState } from 'react'
import { Modal } from './ui'

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
  requireCheck,
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  description?: React.ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
  /** 需要用户勾选才能确认的文案 */
  requireCheck?: string
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (open) setChecked(false)
  }, [open])

  const disabled = busy || (Boolean(requireCheck) && !checked)

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      tone={danger ? 'danger' : 'default'}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onCancel} disabled={busy}>
            {cancelText}
          </button>
          <button
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={onConfirm}
            disabled={disabled}
          >
            {busy ? '处理中…' : confirmText}
          </button>
        </>
      }
    >
      {requireCheck && (
        <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[color-mix(in_srgb,var(--warn)_38%,transparent)] bg-warn-soft px-3 py-2.5">
          <input
            type="checkbox"
            className="mt-0.5 accent-[var(--warn)]"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span className="text-[12.5px] leading-relaxed text-ink">{requireCheck}</span>
        </label>
      )}
    </Modal>
  )
}
