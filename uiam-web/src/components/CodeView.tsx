/**
 * 只读代码视图：行号 + 复制。
 *
 * 不做语法高亮——TOML 的着色价值远小于「行号能对得上日志」这件事，
 * 而为了高亮引一个词法器（含它的体积与升级）在这个场景里不划算。
 */
import { useMemo, useState } from 'react'
import { IconCheck, IconCopy } from './icons'
import { cx } from './ui'

export function CodeView({
  code,
  maxHeight = 420,
  wrap = false,
  className,
}: {
  code: string
  maxHeight?: number
  wrap?: boolean
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const lines = useMemo(() => code.split('\n'), [code])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // 非安全上下文（http + 非 localhost）拿不到剪贴板权限，静默失败即可
    }
  }

  return (
    <div className={cx('relative overflow-hidden rounded-xl border border-line bg-surface-sunken', className)}>
      <button
        className="btn btn-sm absolute right-2 top-2 z-10 !h-7"
        onClick={copy}
        title="复制全文"
      >
        {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
        {copied ? '已复制' : '复制'}
      </button>
      <div className="overflow-auto" style={{ maxHeight }}>
        <div className="flex min-w-full">
          <div
            className="mono select-none border-r border-line px-2.5 py-3 text-right text-[11.5px] leading-[1.65] text-ink-mute"
            aria-hidden="true"
          >
            {lines.map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <pre
            className={cx('code flex-1 px-3 py-3', wrap && 'whitespace-pre-wrap break-words')}
          >
            {code}
          </pre>
        </div>
      </div>
    </div>
  )
}
