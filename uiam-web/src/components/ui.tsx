/**
 * 基础 UI 组件：徽标、表单项、开关、弹窗、抽屉、空态、统计块。
 *
 * 这里刻意不引组件库：管理面只有这几类控件，自己写反而能把「发布前必须看懂
 * 为什么要重启」这类业务约束直接做进组件里（比如 Modal 的 danger 变体）。
 *
 * 弹窗这一层还统一负责四件对每个配置表单都成立的事：焦点进出与 Tab 循环、
 * 未保存修改保护、长表单的固定保存栏、校验问题的可见摘要。不要在某个 Form 里
 * 另写一套——四个表单共用同一套行为，才不会出现「有的能 Esc 撤销、有的点一下
 * 遮罩就把填了半天的 JSON 丢了」。
 */
import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { parseJson, prettyJson } from '../lib/format'
import { IconAlert, IconClose, IconInfo, IconUndo } from './icons'

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
const SAVE_KEY = IS_MAC ? '⌘ + ↵' : 'Ctrl + ↵'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

type Tone = 'brand' | 'ok' | 'warn' | 'danger' | 'mute'

export function Badge({ tone = 'mute', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx('badge', `badge-${tone}`)}>{children}</span>
}

/**
 * 表单字段：label 与控件显式关联，hint / error 走 aria-describedby。
 *
 * `group` 用于「一个标签对应多行输入」（监听地址那种动态列表）：改成 role=group，
 * 不要把一个 label 挂到第一个 input 上，后面的行就都成了没有名字的文本框。
 */
export function Field({
  label,
  hint,
  required,
  error,
  group,
  name,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode
  hint?: ReactNode
  required?: boolean
  error?: ReactNode
  group?: boolean
  /** 错误摘要点击后定位到哪个字段 */
  name?: string
  htmlFor?: string
  children: ReactNode
  className?: string
}) {
  const autoId = useId()
  const fieldId = htmlFor ?? autoId
  const descId = hint || error ? `${fieldId}-desc` : undefined
  const labelId = `${fieldId}-label`

  // 单个控件才注入 id；多个控件（select + JSON 编辑框）请拆成多个 Field，
  // 或自己给第一个控件显式 htmlFor，避免「两个控件抢一个 id」。
  const injected =
    !group && Children.count(children) === 1 && isValidElement(children)
      ? cloneElement(children as ReactElement<Record<string, unknown>>, {
          id: (children as ReactElement<Record<string, unknown>>).props.id ?? fieldId,
          'aria-describedby': descId,
          'aria-invalid': error ? true : undefined,
          'aria-required': required || undefined,
        })
      : children

  return (
    <div className={className} data-field={name}>
      {group ? (
        <div className="label" id={labelId}>
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </div>
      ) : (
        <label className="label" htmlFor={fieldId}>
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </label>
      )}
      {group ? (
        <div role="group" aria-labelledby={labelId} aria-describedby={descId}>
          {children}
        </div>
      ) : (
        injected
      )}
      {error ? (
        <p className="df-err" id={descId}>
          {error}
        </p>
      ) : (
        hint && (
          <p className="hint mt-1.5" id={descId}>
            {hint}
          </p>
        )
      )}
    </div>
  )
}

/** 弹窗里的一块内容分区：靠字号、字重和留白分层，不再套一层卡片 */
export function FormSection({
  title,
  description,
  actions,
  children,
  id,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  id?: string
}) {
  return (
    <section className="df-sec" id={id}>
      <div className="df-sec-h">
        <h3 className="df-sec-t">{title}</h3>
        {actions && <div className="df-sec-a">{actions}</div>}
      </div>
      {description && <p className="df-sec-d">{description}</p>}
      <div className="df-sec-b">{children}</div>
    </section>
  )
}

/** 「我到底在改哪一个」：编辑弹框里最容易看错的东西，放在标题下面第一眼的位置 */
export function FormIdentity({
  kind,
  name,
  meta,
  mono,
}: {
  kind: string
  name: ReactNode
  meta?: ReactNode
  mono?: boolean
}) {
  return (
    <div className="df-id">
      <span className="df-id-k">{kind}</span>
      <span className={cx('df-id-n', mono && 'mono')}>{name}</span>
      {meta && <span className="df-id-m mono">{meta}</span>}
    </div>
  )
}

/** 后果说明。不是装饰性提示框：它回答「保存之后会发生什么」 */
export function FormNotice({
  tone = 'info',
  children,
  action,
}: {
  tone?: 'info' | 'warn' | 'danger'
  children: ReactNode
  action?: ReactNode
}) {
  const Icon = tone === 'info' ? IconInfo : IconAlert
  return (
    <div className={cx('df-notice', `df-notice-${tone}`)}>
      <Icon size={13} />
      <span className="df-notice-t">{children}</span>
      {action && <span className="df-notice-a">{action}</span>}
    </div>
  )
}

/**
 * 「整块替换」的可撤销机会。模板按钮、类型下拉都走它：替换后留一条撤销，
 * 用户一旦自己继续编辑，撤销机会自动消失，不会把新写的内容又盖回去。
 */
export function useReplacementUndo(value: string) {
  const [replaced, setReplaced] = useState<{ next: string; previous: string; label: string } | null>(
    null,
  )

  useEffect(() => {
    if (replaced && value !== replaced.next) setReplaced(null)
  }, [value, replaced])

  const apply = (next: string, label: string, onChange: (v: string) => void) => {
    if (next === value) return
    setReplaced(value.trim() ? { next, previous: value, label } : null)
    onChange(next)
  }

  const undo = (onChange: (v: string) => void) => {
    if (!replaced) return
    onChange(replaced.previous)
    setReplaced(null)
  }

  return { replaced, apply, undo }
}

/**
 * 配置类型下拉（matcher / to / balancer）。
 *
 * 换模板会整块替换用户已经写好的 JSON——原来是一换就没了。这里改成**可撤销**：
 * 选「（自定义）」也不再清空内容。
 */
export function TypeSelect({
  templates,
  value,
  onChange,
  id,
  className,
  'aria-describedby': describedBy,
}: {
  templates: Record<string, string>
  value: string
  onChange: (json: string) => void
} & Pick<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'className' | 'aria-describedby'>) {
  const { replaced, apply, undo } = useReplacementUndo(value)

  const parsed = parseJson(value)
  const rawType =
    parsed && typeof parsed === 'object' && 'type' in parsed
      ? (parsed as Record<string, unknown>).type
      : undefined
  const currentType = typeof rawType === 'string' && templates[rawType] ? rawType : ''

  const selectType = (type: string) => {
    if (!type || type === currentType) return
    apply(prettyJson(templates[type]), type, onChange)
  }

  return (
    <div className={className}>
      <select
        id={id}
        className="select"
        aria-describedby={describedBy}
        value={currentType}
        onChange={(e) => selectType(e.target.value)}
      >
        <option value="">（自定义 / 保留当前内容）</option>
        {Object.keys(templates).map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      {replaced && (
        <div className="df-undo" role="status">
          <span>已换成「{replaced.label}」模板</span>
          <button type="button" onClick={() => undo(onChange)}>
            <IconUndo size={11} /> 撤销
          </button>
        </div>
      )}
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
      <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold tracking-[-0.1px] text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-mute">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  )
}

export function Stat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="stat">
      <p className="text-[10.5px] font-semibold tracking-[0.35px] text-ink-mute">{label}</p>
      <p className="num mt-1 text-[22px] font-semibold leading-none text-ink">{value}</p>
      {hint && <p className="mt-1.5 text-[11px] text-ink-mute">{hint}</p>}
    </div>
  )
}

export type FormIssue = string | { text: string; target?: string }

/**
 * 通用遮罩弹窗。
 *
 * - 头 / 滚动体 / 脚三段固定：高级配置展开后表单再长，保存按钮也不会滚出屏幕；
 * - 焦点进来时落在第一个输入框，Tab 在框内循环，关闭后焦点还给触发它的元素；
 * - `dirty` 时点遮罩、Esc、关闭都先问一句，绝不静默丢掉未保存的内容；
 * - `busy` 时不接受关闭（保存请求还在飞）；
 * - `onSubmit` 提供 Ctrl/⌘ + Enter 保存，`issues` 是可以点击定位的错误摘要。
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 560,
  tone = 'default',
  dirty = false,
  busy = false,
  onSubmit,
  revealIssues,
  footerNote,
  progress,
  issues = [],
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** 函数形式能拿到受保护的关闭动作：取消按钮也要过「未保存」确认 */
  footer?: ReactNode | ((api: { requestClose: () => void; busy: boolean }) => ReactNode)
  width?: number
  tone?: 'default' | 'danger'
  dirty?: boolean
  busy?: boolean
  onSubmit?: () => void
  /** 表单在「点了保存但被拦下」时递增，Modal 才把焦点交给错误摘要 */
  revealIssues?: number
  footerNote?: ReactNode
  progress?: ReactNode
  issues?: FormIssue[]
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const keepRef = useRef<HTMLButtonElement>(null)
  const issuesRef = useRef<HTMLDivElement>(null)
  const revealRef = useRef(0)
  const [guarding, setGuarding] = useState(false)
  const titleId = useId()
  const descId = useId()

  const requestClose = useCallback(() => {
    if (busy) return
    if (dirty) {
      setGuarding(true)
      return
    }
    onClose()
  }, [busy, dirty, onClose])

  useEffect(() => {
    if (!open) {
      setGuarding(false)
      return
    }
    restoreRef.current = document.activeElement as HTMLElement | null
    const raf = requestAnimationFrame(() => {
      const root = dialogRef.current
      if (!root) return
      const target =
        root.querySelector<HTMLElement>('[data-autofocus]') ??
        root.querySelector<HTMLElement>(
          '.df-body input:not([disabled]), .df-body select:not([disabled]), .df-body textarea:not([disabled])',
        ) ??
        root.querySelector<HTMLElement>('.df-close')
      target?.focus()
    })
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      cancelAnimationFrame(raf)
      document.body.style.overflow = prev
      restoreRef.current?.focus()
    }
  }, [open])

  // 键盘：Esc 关闭（有改动先保护）、Tab 循环、Ctrl/⌘ + Enter 提交
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (guarding) {
          setGuarding(false)
          return
        }
        requestClose()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (!busy && onSubmit) {
          e.preventDefault()
          onSubmit()
        }
        return
      }
      if (e.key !== 'Tab' || !dialogRef.current) return
      const nodes = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null)
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, guarding, busy, onSubmit, requestClose])

  useEffect(() => {
    if (guarding) keepRef.current?.focus()
  }, [guarding])

  // 只在「提交被拦下」时把焦点交给错误摘要（WCAG 的可聚焦错误摘要）。
  // 不用 issues 内容变化当信号：打字途中多一条错误会抢走 textarea 的焦点。
  useEffect(() => {
    if (!open) {
      revealRef.current = revealIssues ?? 0
      return
    }
    if (revealIssues !== undefined && revealIssues !== revealRef.current) {
      revealRef.current = revealIssues
      issuesRef.current?.focus()
    }
  }, [open, revealIssues])

  if (!open) return null

  const focusIssue = (target: string) => {
    const scope = dialogRef.current?.querySelector<HTMLElement>(`[data-field="${target}"]`)
    const control = scope?.querySelector<HTMLElement>('input, select, textarea, button')
    control?.focus()
    scope?.scrollIntoView({ block: 'center' })
  }

  return createPortal(
    <div className="fixed inset-0 z-[9800] flex items-start justify-center overflow-y-auto p-4 sm:items-center sm:p-6">
      {/* 遮罩不加 backdrop-filter：它罩着整个窗口，任何一帧重绘都要重算一次模糊 */}
      <div className="fixed inset-0 bg-[rgba(10,14,22,0.52)]" onClick={requestClose} />
      <div
        ref={dialogRef}
        className="panel panel-dialog pop-in df-dialog relative z-10 my-auto flex w-full flex-col"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
      >
        <header className="df-head">
          <div className="min-w-0">
            <h2
              id={titleId}
              className={cx('text-[15px] font-semibold', tone === 'danger' ? 'text-danger' : 'text-ink')}
            >
              {title}
            </h2>
            {description && (
              <p id={descId} className="df-desc">
                {description}
              </p>
            )}
          </div>
          <div className="df-head-r">
            {dirty && (
              <span className="df-dirty" title="有尚未保存的修改">
                <i /> 未保存
              </span>
            )}
            <button
              className="btn btn-ghost btn-sm df-close"
              onClick={requestClose}
              aria-label="关闭（Esc）"
              title="关闭（Esc）"
            >
              <IconClose size={15} />
            </button>
          </div>
        </header>

        {guarding && (
          <div className="df-guard" role="alertdialog" aria-label="有未保存的修改">
            <IconAlert size={14} />
            <span className="df-guard-t">改动还没保存，确定要放弃吗？</span>
            <div className="df-guard-a">
              <button ref={keepRef} className="btn btn-sm" onClick={() => setGuarding(false)}>
                继续编辑
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={() => {
                  setGuarding(false)
                  onClose()
                }}
              >
                放弃修改
              </button>
            </div>
          </div>
        )}

        {children && <div className="df-body min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>}

        {(issues.length > 0 || footer || footerNote || progress) && (
          <footer className="df-foot">
            {issues.length > 0 && (
              <div ref={issuesRef} className="df-issues" role="alert" aria-live="polite" tabIndex={-1}>
                <IconAlert size={13} />
                <ul>
                  {issues.map((issue, i) => {
                    const text = typeof issue === 'string' ? issue : issue.text
                    const target = typeof issue === 'string' ? undefined : issue.target
                    return (
                      <li key={`${text}-${i}`}>
                        {target ? (
                          <button type="button" onClick={() => focusIssue(target)}>
                            {text}
                          </button>
                        ) : (
                          text
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            <div className="df-foot-row">
              {(footerNote || progress) && (
                <div className="df-foot-note">
                  {footerNote && <span>{footerNote}</span>}
                  {progress && <span className="df-progress">{progress}</span>}
                </div>
              )}
              <div className="df-foot-actions">
                {onSubmit && !busy && <span className="df-keys">{SAVE_KEY} 保存</span>}
                {typeof footer === 'function' ? footer({ requestClose, busy }) : footer}
              </div>
            </div>
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
