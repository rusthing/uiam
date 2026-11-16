/**
 * JSON 列的编辑器。
 *
 * 库里 `matcher_json` / `to_json` / `config_json` / `ops_json` 这些列存的是
 * gatex 配置类型的 JSON 文本，变体多到没法做成固定表单，所以直接给文本框——
 * 但必须补两件固定表单本来会免费给的东西：
 *
 * 1. **即时合法性提示**：服务端只会在保存时告诉你「JSON 解析失败」，
 *    在这里先标出来能省一次往返；错误要说清怎么恢复，而不是只说「错了」；
 * 2. **模板**：`type` 字段是 tag，写错一个大小写（`prefix` vs `Prefix`）就会在
 *    渲染阶段才炸，模板把它变成点一下；替换后可撤销，不会吃掉已写好的配置。
 */
import { useMemo, type TextareaHTMLAttributes } from 'react'
import { isValidJson, prettyJson } from '../lib/format'
import { cx, useReplacementUndo } from './ui'
import { IconUndo } from './icons'

export interface JsonTemplate {
  label: string
  json: string
  hint?: string
}

type NativeProps = Pick<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'id' | 'aria-describedby' | 'aria-invalid' | 'aria-required'
>

export function JsonEditor({
  value,
  onChange,
  rows = 8,
  placeholder,
  templates,
  className,
  ...native
}: {
  value: string
  onChange: (next: string) => void
  rows?: number
  placeholder?: string
  templates?: JsonTemplate[]
  className?: string
} & NativeProps) {
  const valid = useMemo(() => isValidJson(value), [value])
  const { replaced, apply, undo } = useReplacementUndo(value)

  return (
    <div className={className}>
      <div className="relative">
        <textarea
          {...native}
          className={cx('textarea', !valid && '!border-danger')}
          style={{ minHeight: rows * 22 }}
          aria-invalid={!valid || undefined}
          value={value}
          spellCheck={false}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        <div className="pointer-events-none absolute bottom-1.5 right-2 flex items-center gap-2">
          {!valid && (
            <span className="text-[11px] font-medium text-danger" role="status">
              JSON 语法错误 · 检查逗号与引号
            </span>
          )}
          <button
            type="button"
            className="pointer-events-auto rounded-md px-1.5 py-0.5 text-[11px] text-ink-mute transition-colors hover:bg-surface-hover hover:text-ink"
            onClick={() => onChange(prettyJson(value))}
            title="整理缩进，不改内容"
          >
            格式化
          </button>
        </div>
      </div>

      {replaced && (
        <div className="df-undo" role="status">
          <span>已填入「{replaced.label}」</span>
          <button type="button" onClick={() => undo(onChange)}>
            <IconUndo size={11} /> 撤销
          </button>
        </div>
      )}

      {templates && templates.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-ink-mute">模板</span>
          {templates.map((t) => (
            <button
              key={t.label}
              type="button"
              title={t.hint ?? `填入「${t.label}」模板，可撤销`}
              className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-soft transition-colors hover:border-brand-line hover:bg-brand-soft hover:text-brand"
              onClick={() => apply(prettyJson(t.json), t.label, onChange)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
