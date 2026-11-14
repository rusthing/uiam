/**
 * 当前选中的网关实例：桌面 widget 与网关窗口共享的一个「小状态」。
 *
 * 单独抽出来是因为它跨了两个组件树——点 widget 里的「去发布」要打开网关窗口并
 * 定位到那个实例，用 context 会把两棵树绑死，用 URL 又回到「桌面不是文档」的问题。
 * 一个模块级 store + `useSyncExternalStore` 足够，顺带存 localStorage，刷新后还停在
 * 上次看的实例上。
 */
const KEY = 'uiam-current-gateway'

function read(): string {
  try {
    return localStorage.getItem(KEY) || ''
  } catch {
    return ''
  }
}

let current = read()
const listeners = new Set<() => void>()

export function subscribeSelection(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSelection(): string {
  return current
}

export function selectGateway(id: string) {
  if (id === current) return
  current = id
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // 存不下不影响本次会话
  }
  listeners.forEach((l) => l())
}
