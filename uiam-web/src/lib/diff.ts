/**
 * 行级差异。
 *
 * 回滚前最该看的是「这一版和上一版差在哪」，而不是两份 400 行的 TOML 自己肉眼比。
 * 用最朴素的 LCS 动态规划：配置文本量级在几百行，O(n·m) 完全够用，
 * 不值得为它引一个 diff 库（那些库还要处理「词级最小化」这类我们不需要的东西）。
 */

export type DiffKind = 'same' | 'add' | 'del'

export interface DiffLine {
  kind: DiffKind
  text: string
  /** 旧文件里的行号（1 起），新增行为 undefined */
  oldLine?: number
  /** 新文件里的行号（1 起），删除行为 undefined */
  newLine?: number
}

/**
 * # 计算两份文本的行级差异
 *
 * ## 参数
 * * `before` - 旧内容
 * * `after` - 新内容
 *
 * ## 返回值
 * 按顺序排列的行数组，`kind` 标明这一行是相同、新增还是删除
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const n = a.length
  const m = b.length

  // lcs[i][j] = a[i..] 与 b[j..] 的最长公共子序列长度
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i], oldLine: i + 1, newLine: j + 1 })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: 'del', text: a[i], oldLine: i + 1 })
      i++
    } else {
      out.push({ kind: 'add', text: b[j], newLine: j + 1 })
      j++
    }
  }
  while (i < n) {
    out.push({ kind: 'del', text: a[i], oldLine: i + 1 })
    i++
  }
  while (j < m) {
    out.push({ kind: 'add', text: b[j], newLine: j + 1 })
    j++
  }
  return out
}

/** 差异统计：`{ added, removed }` */
export function diffStat(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.kind === 'add') added++
    else if (line.kind === 'del') removed++
  }
  return { added, removed }
}
