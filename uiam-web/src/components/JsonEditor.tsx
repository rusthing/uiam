/**
 * JSON 列的编辑器。
 *
 * 库里 `matcher_json` / `to_json` / `config_json` / `ops_json` 这些列存的是
 * gatex 配置类型的 JSON 文本，变体多到没法做成固定表单，所以直接给文本框——
 * 但必须补两件固定表单本来会免费给的东西：
 *
 * 1. **即时合法性提示**：服务端只会在保存时告诉你「JSON 解析失败」，
 *    在这里先标出来能省一次往返；
 * 2. **模板**：`type` 字段是 tag，写错一个大小写（`prefix` vs `Prefix`）就会在
 *    渲染阶段才炸，模板把它变成点一下。
 */
import { useMemo } from 'react'
import { isValidJson, prettyJson } from '../lib/format'
import { cx } from './ui'

export interface JsonTemplate {
  label: string
  json: string
  hint?: string
}

export function JsonEditor({
  value,
  onChange,
  rows = 8,
  placeholder,
  templates,
  className,
}: {
  value: string
  onChange: (next: string) => void
  rows?: number
  placeholder?: string
  templates?: JsonTemplate[]
  className?: string
}) {
  const valid = useMemo(() => isValidJson(value), [value])

  return (
    <div className={className}>
      <div className="relative">
        <textarea
          className={cx('textarea', !valid && '!border-danger')}
          style={{ minHeight: rows * 22 }}
          value={value}
          spellCheck={false}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        <div className="pointer-events-none absolute bottom-1.5 right-2 flex items-center gap-2">
          {!valid && <span className="text-[11px] font-medium text-danger">JSON 语法错误</span>}
          <button
            type="button"
            className="pointer-events-auto rounded-md px-1.5 py-0.5 text-[11px] text-ink-mute transition-colors hover:bg-surface-hover hover:text-ink"
            onClick={() => onChange(prettyJson(value))}
          >
            格式化
          </button>
        </div>
      </div>
      {templates && templates.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-ink-mute">模板</span>
          {templates.map((t) => (
            <button
              key={t.label}
              type="button"
              title={t.hint}
              className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-soft transition-colors hover:border-brand-line hover:bg-brand-soft hover:text-brand"
              onClick={() => onChange(prettyJson(t.json))}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
