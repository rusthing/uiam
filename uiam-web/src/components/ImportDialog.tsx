/**
 * 导入现有 TOML：把一份已经在跑的网关配置拆成结构化数据落库。
 *
 * ## 为什么这个弹窗必须存在
 *
 * 线上网关的配置是手写 TOML 直接 PUT 进 Consul KV 的，uiam 库里没有对应数据。
 * 没有导入这一步，「接管线上网关」就变成了「点一次发布，把 40 多条路由全删掉」。
 *
 * ## 交互刻意分成三步，不允许一步到底
 *
 * 1. **取**：从 Consul 把网关正在读的那份原文拉出来（或者手工贴）
 * 2. **预演**：只解析、只模拟渲染，不写库。看计数对不对、`kvMatches` 是不是
 *    `true`、`warnings` 里有没有意外
 * 3. **导入**：整段替换库里的监听器/路由/负载均衡器
 *
 * 第 2 步不可跳过——导入是整段替换，库里多一条少一条路由都不会报错，
 * 只有预演能提前看见。所以「正式导入」按钮在预演成功之前是禁用的。
 *
 * ## `kvMatches` 读法
 *
 * - `true`：库里现在的配置与线上一致 → 之后发布不会改变网关行为，接管安全
 * - `false`：不一致 → 看 `kvDiff` 逐条确认；**这时候发布就是改线上配置**
 * - `null`：没比对（key 不存在、Consul 读不到）
 */
import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import type { Gateway, GatewayImportResult, GatewayImportSource } from '../lib/types'
import { ConfirmDialog } from './ConfirmDialog'
import { useToast } from './Toast'
import { Badge, Field, Modal, Spinner } from './ui'
import { IconAlert, IconCheck, IconInfo, IconRefresh } from './icons'

export function ImportDialog({
  open,
  gateway,
  onClose,
  onImported,
}: {
  open: boolean
  gateway: Gateway | null
  onClose: () => void
  onImported: () => void
}) {
  const toast = useToast()

  const [toml, setToml] = useState('')
  const [consulKey, setConsulKey] = useState('')
  const [source, setSource] = useState<GatewayImportSource | null>(null)
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [result, setResult] = useState<GatewayImportResult | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  // 每次打开都回到干净状态：上一个实例的 TOML 留在这里是事故来源
  useEffect(() => {
    if (!open) return
    setToml('')
    setConsulKey(gateway?.consulKey ?? '')
    setSource(null)
    setResult(null)
    setError(undefined)
    setBusy(false)
    setReading(false)
  }, [open, gateway])

  // TOML 或目标 key 一改，上一次的预演结论就作废了——不能拿旧结论去放行新内容
  useEffect(() => {
    setResult(null)
    setError(undefined)
  }, [toml, consulKey])

  const readFromConsul = async () => {
    if (!gateway) return
    setReading(true)
    setError(undefined)
    try {
      const data = await api.importToml.source(gateway.id, consulKey.trim() || undefined)
      setSource(data)
      if (data.found) {
        setToml(data.content)
        setConsulKey(data.consulKey)
        toast.success(`已读取 ${data.fullKey}（${data.content.length} 字节）`)
      } else {
        toast.info(data.note ?? `${data.fullKey} 里没有内容`)
      }
    } catch (e) {
      setError((e as ApiError).message)
    } finally {
      setReading(false)
    }
  }

  const run = async (dryRun: boolean) => {
    if (!gateway || !toml.trim()) return
    setBusy(true)
    setError(undefined)
    try {
      const data = await api.importToml.run(gateway.id, {
        toml,
        consulKey: consulKey.trim() || null,
        dryRun,
      })
      setResult(data)
      if (!dryRun) {
        toast.success(
          `已导入：${data.httpListeners + data.tcpListeners} 个监听器、` +
            `${data.httpRoutes + data.tcpRoutes} 条路由、${data.balancers} 个负载均衡器`,
        )
        onImported()
        onClose()
      }
    } catch (e) {
      setError((e as ApiError).message)
      setResult(null)
    } finally {
      setBusy(false)
      setConfirmOpen(false)
    }
  }

  const canPreview = Boolean(gateway) && toml.trim() !== '' && !busy
  const canApply = canPreview && result !== null && result.dryRun
  const totalListeners = result ? result.httpListeners + result.tcpListeners : 0
  const totalRoutes = result ? result.httpRoutes + result.tcpRoutes : 0

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        width={920}
        title="导入现有 TOML"
        description={
          <>
            把一份已经在跑的网关配置拆成监听器、路由、负载均衡器和实例级配置，
            <b>整段替换</b>这个实例现有的数据。这是「接管线上网关」的前置步骤——
            库里没有数据时点发布会把线上的路由全删掉。
          </>
        }
        footer={
          <>
            <button className="btn" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button className="btn" onClick={() => run(true)} disabled={!canPreview}>
              {busy && !confirmOpen ? <Spinner size={12} /> : null} 预演
            </button>
            <button
              className="btn btn-primary"
              onClick={() => setConfirmOpen(true)}
              disabled={!canApply}
              title={canApply ? undefined : '必须先跑一次预演，确认无误后才能正式导入'}
            >
              正式导入
            </button>
          </>
        }
      >
        {/* ---- 第一步：取 ---- */}
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field
            label="目标 Consul KV key"
            hint={
              <>
                留空则用实例当前的 <span className="mono">{gateway?.consulKey ?? '—'}</span>。
                环境前缀由服务端 <span className="mono">[consul] key-prefix</span> 补，不要手写{' '}
                <span className="mono">dev/</span>。
              </>
            }
          >
            <input
              className="input mono"
              value={consulKey}
              onChange={(e) => setConsulKey(e.target.value)}
              placeholder={gateway?.consulKey ?? 'gatex-rs-svr00.toml'}
            />
          </Field>
          <button className="btn btn-sm mb-[22px]" onClick={readFromConsul} disabled={reading || !gateway}>
            {reading ? <Spinner size={12} /> : <IconRefresh size={13} />} 从 Consul 读取
          </button>
        </div>

        {source && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-sunken px-3 py-2 text-[12px] text-ink-soft">
            {source.found ? (
              <Badge tone="ok">
                <IconCheck size={11} /> 读到 {source.content.length} 字节
              </Badge>
            ) : (
              <Badge tone="warn">
                <IconAlert size={11} /> 未读到内容
              </Badge>
            )}
            <span className="mono">{source.fullKey}</span>
            {source.modifyIndex !== null && (
              <span className="text-ink-mute">ModifyIndex {source.modifyIndex}</span>
            )}
            {source.note && <span className="text-ink-mute">{source.note}</span>}
          </div>
        )}

        {/* ---- TOML 编辑框 ---- */}
        <Field
          label="TOML 原文"
          hint="必须是 gatex 能直接吃下的完整配置（含 [[listeners]] / [balancers] 等），不是片段。解析失败会带出错的行列号。"
        >
          <textarea
            className="textarea mono text-[11.5px] leading-[1.55]"
            rows={16}
            spellCheck={false}
            value={toml}
            onChange={(e) => setToml(e.target.value)}
            placeholder="点上方「从 Consul 读取」，或者把 TOML 贴进来…"
          />
        </Field>

        {error && (
          <div className="mt-3 whitespace-pre-wrap rounded-xl border border-[color-mix(in_srgb,var(--danger)_38%,transparent)] bg-danger-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-danger">
            {error}
          </div>
        )}

        {/* ---- 第二步：预演结论 ---- */}
        {result && (
          <div className="mt-4 rounded-xl border border-line">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2.5">
              <span className="text-[12.5px] font-medium text-ink">
                {result.dryRun ? '预演结果' : '导入结果'}
              </span>
              <Badge tone="mute">{totalListeners} 个监听器</Badge>
              <Badge tone="mute">{totalRoutes} 条路由</Badge>
              <Badge tone="mute">{result.balancers} 个负载均衡器</Badge>
              <span className="ml-auto flex items-center gap-2">
                {result.kvMatches === true && (
                  <Badge tone="ok">
                    <IconCheck size={11} /> 与线上一致
                  </Badge>
                )}
                {result.kvMatches === false && (
                  <Badge tone="danger">
                    <IconAlert size={11} /> 与线上不一致
                  </Badge>
                )}
                {result.kvMatches === null && (
                  <Badge tone="mute">
                    <IconInfo size={11} /> 未与线上比对
                  </Badge>
                )}
              </span>
            </div>

            <div className="px-3.5 py-2.5 text-[12px] leading-relaxed">
              {result.kvMatches === true && (
                <p className="text-ok">
                  库里这份与 <span className="mono">{result.consulKey}</span> 里的内容语义一致
                  ——接管之后点发布不会改变网关行为。
                </p>
              )}
              {result.kvMatches === false && (
                <p className="text-danger">
                  与线上内容不一致，<b>发布就会改线上行为</b>。逐条确认下面的差异再决定。
                </p>
              )}
              {result.kvMatches === null && result.kvDiff.length > 0 && (
                <p className="text-ink-mute">{result.kvDiff[0]}</p>
              )}

              {result.kvDiff.length > 0 && result.kvMatches === false && (
                <ul className="mt-2 max-h-[220px] space-y-1 overflow-auto">
                  {result.kvDiff.map((line, i) => (
                    <li key={i} className="mono text-[11.5px] text-ink-soft">
                      · {line}
                    </li>
                  ))}
                </ul>
              )}

              {result.warnings.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {result.warnings.map((line, i) => (
                    <li key={i} className="text-warn">
                      ! {line}
                    </li>
                  ))}
                </ul>
              )}

              <p className="mt-2 text-ink-mute">
                导入后渲染出的摘要 <span className="mono">{result.checksum.slice(0, 16)}…</span>
                ，与发布时写进 KV 的是同一份字节流。
              </p>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        title="整段替换配置"
        danger={result?.kvMatches !== true}
        confirmText="确认导入"
        busy={busy}
        requireCheck={
          result?.kvMatches === true
            ? undefined
            : '我知道这次导入会改变网关行为（与线上不一致），发布前会再确认一遍。'
        }
        description={
          result ? (
            <>
              将把这个实例现有的监听器 / 路由 / 负载均衡器全部删掉，换成这份 TOML 里的：
              <b>
                {totalListeners} 个监听器、{totalRoutes} 条路由、{result.balancers} 个负载均衡器
              </b>
              。<br />
              只改库，<b>不写 Consul KV</b>——线上网关这一刻还在跑原来的配置，
              要生效得再点一次发布。
            </>
          ) : null
        }
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => run(false)}
      />
    </>
  )
}
