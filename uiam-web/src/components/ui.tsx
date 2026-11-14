/**
 * 基础 UI 组件：徽标、表单项、开关、弹窗、抽屉、空态、统计块。
 *
 * 这里刻意不引组件库：管理面只有这几类控件，自己写反而能把「发布前必须看懂
 * 为什么要重启」这类业务约束直接做进组件里（比如 Modal 的 danger 变体）。
 */
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconClose } from './icons'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

type Tone = 'brand' | 'ok' | 'warn' | 'danger' | 'mute'

export function Badge({ tone = 'mute', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx('badge', `badge-${tone}`)}>{children}</span>
}

export function Field({
  label,
  hint,
  required,
  children,
  className,
}: {
  label: ReactNode
  hint?: ReactNode
  required?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label className="label">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {children}
      {hint && <p className="hint mt-1.5">{hint}</p>}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label?: ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'inline-flex items-center gap-2 text-[13px] transition-opacity',
        disabled && 'opacity-50',
      )}
    >
      <span
        className={cx(
          'relative h-[20px] w-[34px] rounded-full border transition-colors',
          checked
            ? 'border-transparent bg-brand'
            : 'border-line-strong bg-surface-sunken',
        )}
      >
        <span
          className={cx(
            'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all',
            checked ? 'left-[17px]' : 'left-[2px]',
          )}
        />
      </span>
      {label && <span className="text-ink-soft">{label}</span>}
    </button>
  )
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px]"
      style={{ width: size, height: size, opacity: 0.6 }}
    />
  )
}

export function Empty({
  title,
  description,
  action,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <p className="text-[13.5px] font-medium text-ink">{title}</p>
      {description && <p className="max-w-[42ch] text-[12.5px] text-ink-mute">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="panel overflow-hidden">
      <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
        <div>
          <h2 className="text-[13.5px] font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-[12px] text-ink-mute">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  )
}

export function Stat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface-sunken px-3.5 py-3">
      <p className="text-[11.5px] text-ink-mute">{label}</p>
      <p className="mt-0.5 text-[18px] font-semibold leading-tight text-ink">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-ink-mute">{hint}</p>}
    </div>
  )
}

/** 通用遮罩弹窗：ESC 关闭、点遮罩关闭、打开时锁滚动 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 560,
  tone = 'default',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  width?: number
  tone?: 'default' | 'danger'
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[9800] flex items-start justify-center overflow-y-auto p-6 sm:items-center">
      <div
        className="fixed inset-0 bg-[rgba(10,14,22,0.42)] backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        className="panel pop-in relative z-10 my-auto w-full"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-start justify-between gap-4 px-5 pb-1 pt-4">
          <div>
            <h2
              className={cx(
                'text-[15px] font-semibold',
                tone === 'danger' ? 'text-danger' : 'text-ink',
              )}
            >
              {title}
            </h2>
            {description && (
              <p className="mt-1 max-w-[60ch] text-[12.5px] leading-relaxed text-ink-soft">
                {description}
              </p>
            )}
          </div>
          <button className="btn btn-ghost btn-sm -mr-1.5" onClick={onClose} aria-label="关闭">
            <IconClose size={15} />
          </button>
        </header>
        {children && <div className="px-5 py-4">{children}</div>}
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** 右侧抽屉：放长内容（TOML 预览、发布历史内容），不打断主界面 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 720,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[9800] flex justify-end">
      <div className="absolute inset-0 bg-[rgba(10,14,22,0.38)]" onClick={onClose} />
      <aside
        className="slide-in-right relative flex h-full w-full flex-col border-l border-line bg-surface-strong shadow-2xl"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
            {subtitle && <div className="mt-0.5 text-[12px] text-ink-mute">{subtitle}</div>}
          </div>
          <button className="btn btn-ghost btn-sm -mr-1.5" onClick={onClose} aria-label="关闭">
            <IconClose size={15} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
            {footer}
          </footer>
        )}
      </aside>
    </div>,
    document.body,
  )
}
