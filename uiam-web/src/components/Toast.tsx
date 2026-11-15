/**
 * 轻量提示：右下角堆叠，4 秒自动消失。
 *
 * 用 context 而不是 window 事件，是为了让「谁弹的提示」在类型上就能看出来；
 * 发布/回滚这类操作的结果必须原样展示服务端 `msg`（里面写着「已跳过」「要重启」
 * 这类结论），所以 toast 只负责显示，不做任何措辞加工。
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { IconAlert, IconCheck, IconInfo, IconClose } from './icons'
import { cx } from './ui'

type ToastKind = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

let seq = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = ++seq
      setItems((prev) => [...prev.slice(-3), { id, kind, message }])
      window.setTimeout(() => remove(id), kind === 'error' ? 7000 : 4200)
    },
    [remove],
  )

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed bottom-[86px] left-1/2 z-[9850] flex w-[min(560px,calc(100vw-40px))] -translate-x-1/2 flex-col gap-2">
          {items.map((item) => (
            <div
              key={item.id}
              className={cx(
                'pointer-events-auto pop-in flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[12.5px] leading-relaxed shadow-lg',
                item.kind === 'success' &&
                  'border-[color-mix(in_srgb,var(--ok)_35%,transparent)] bg-[color-mix(in_srgb,var(--ok-soft)_92%,var(--surface-strong))] text-ink',
                item.kind === 'error' &&
                  'border-[color-mix(in_srgb,var(--danger)_38%,transparent)] bg-[color-mix(in_srgb,var(--danger-soft)_92%,var(--surface-strong))] text-ink',
                item.kind === 'info' && 'border-line bg-surface-strong text-ink',
              )}
            >
              <span
                className={cx(
                  'mt-0.5 shrink-0',
                  item.kind === 'success' && 'text-ok',
                  item.kind === 'error' && 'text-danger',
                  item.kind === 'info' && 'text-brand',
                )}
              >
                {item.kind === 'success' ? (
                  <IconCheck size={15} />
                ) : item.kind === 'error' ? (
                  <IconAlert size={15} />
                ) : (
                  <IconInfo size={15} />
                )}
              </span>
              <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{item.message}</p>
              <button
                className="-mr-1 shrink-0 text-ink-mute transition-colors hover:text-ink"
                onClick={() => remove(item.id)}
                aria-label="关闭提示"
              >
                <IconClose size={13} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用')
  return ctx
}
