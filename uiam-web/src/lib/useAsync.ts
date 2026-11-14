import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 极简的异步取数 hook：`data / error / loading / reload`。
 *
 * 只做三件容易漏的事：
 * - **卸载后不 setState**（用 `alive` 标记，避免 React 18+ 的警告与内存泄漏）；
 * - **依赖变化自动重取**；
 * - **`reload()` 手动重取**（增删改之后调它，比把整个列表状态提到父层简单）。
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<Error | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const alive = useRef(true)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fnRef
      .current()
      .then((value) => {
        if (cancelled || !alive.current) return
        setData(value)
        setError(undefined)
      })
      .catch((e: Error) => {
        if (cancelled || !alive.current) return
        setError(e)
      })
      .finally(() => {
        if (cancelled || !alive.current) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const reload = useCallback(() => setTick((v) => v + 1), [])
  return { data, error, loading, reload }
}
