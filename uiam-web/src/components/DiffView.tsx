/**
 * 行级差异视图。
 *
 * 除了着色，还做了**上下文折叠**：配置动辄几百行，改动往往只有三五处，
 * 不折叠的话用户要在整屏「没变的行」里找那三行——比不看 diff 还慢。
 * 默认保留每处改动前后各 3 行。
 */
import { useMemo } from 'react'
import { diffStat, type DiffLine } from '../lib/diff'
import { cx } from './ui'

const CONTEXT = 3

type Row = DiffLine | { kind: 'fold'; count: number }

function fold(lines: DiffLine[]): Row[] {
  const keep = new Set<number>()
  lines.forEach((line, index) => {
    if (line.kind === 'same') return
    for (let i = index - CONTEXT; i <= index + CONTEXT; i++) {
      if (i >= 0 && i < lines.length) keep.add(i)
    }
  })

  const rows: Row[] = []
  let pending = 0
  lines.forEach((line, index) => {
    if (keep.has(index)) {
      if (pending > 0) {
        rows.push({ kind: 'fold', count: pending })
        pending = 0
      }
      rows.push(line)
    } else {
      pending++
    }
  })
  if (pending > 0) rows.push({ kind: 'fold', count: pending })
  return rows
}

export function DiffView({
  lines,
  maxHeight = 520,
}: {
  lines: DiffLine[]
  maxHeight?: number
}) {
  const rows = useMemo(() => fold(lines), [lines])
  const stat = useMemo(() => diffStat(lines), [lines])

  if (stat.added === 0 && stat.removed === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface-sunken px-3 py-6 text-center text-[12.5px] text-ink-mute">
        两份内容逐字节相同，没有差异。
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-sunken">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[11.5px]">
        <span className="text-ok">+{stat.added}</span>
        <span className="text-danger">-{stat.removed}</span>
        <span className="ml-auto text-ink-mute">改动前后各保留 {CONTEXT} 行上下文</span>
      </div>
      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="w-full border-collapse font-mono text-[12px] leading-[1.6]">
          <tbody>
            {rows.map((row, index) => {
              if (row.kind === 'fold') {
                return (
                  <tr key={`f${index}`} className="text-ink-mute">
                    <td colSpan={4} className="select-none px-3 py-0.5 text-center text-[11px]">
                      ⋯ {row.count} 行未变
                    </td>
                  </tr>
                )
              }
              return (
                <tr
                  key={`l${index}`}
                  className={cx(
                    row.kind === 'add' && 'bg-ok-soft',
                    row.kind === 'del' && 'bg-danger-soft',
                  )}
                >
                  <td className="w-[46px] select-none border-r border-line px-2 text-right text-[11px] text-ink-mute">
                    {row.oldLine ?? ''}
                  </td>
                  <td className="w-[46px] select-none border-r border-line px-2 text-right text-[11px] text-ink-mute">
                    {row.newLine ?? ''}
                  </td>
                  <td
                    className={cx(
                      'w-[18px] select-none px-1 text-center',
                      row.kind === 'add' && 'text-ok',
                      row.kind === 'del' && 'text-danger',
                      row.kind === 'same' && 'text-ink-mute',
                    )}
                  >
                    {row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ''}
                  </td>
                  <td
                    className={cx(
                      'whitespace-pre px-2',
                      row.kind === 'same' ? 'text-ink-soft' : 'text-ink',
                    )}
                  >
                    {row.text || ' '}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
