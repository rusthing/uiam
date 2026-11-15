/**
 * 网关配置窗口：左侧实例列表（Finder 双栏），右侧当前实例的全部可编辑面。
 *
 * 与上一版「侧边栏 + 独立页面」的区别只有两点，但都很关键：
 *
 * 1. **切实例不再是路由跳转**，而是窗口内的选中态。桌面上的窗口是「开着的东西」，
 *    点一下实例就把地址栏改掉、窗口重建一次，不符合桌面的手感。
 * 2. **标签栏换成 macOS 分段控件**，因为它和窗口标题栏处在同一个视觉层级里，
 *    用下划线 tab 会跟标题栏抢注意力。
 *
 * 数据流没动：`useGatewayTree` 取整棵子树，改完统一 `reload()`，发布三态
 * （预览 / 确认 / 回执）共享同一份 preview——这条链路已经真机验证过，不重写。
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { api, ApiError } from '../lib/api'
import { describeAddrs, relativeTime } from '../lib/format'
import type { PublishResult, Release, RenderPreview } from '../lib/types'
import { useGatewayList } from '../state/GatewayList'
import { useGatewayTree } from '../state/useGatewayTree'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { GatewayForm } from '../components/GatewayForm'
import { ImportDialog } from '../components/ImportDialog'
import { PublishDialog, PreviewDrawer, ResultDialog } from '../components/Publish'
import { useToast } from '../components/Toast'
import { Badge, cx, Empty, Spinner } from '../components/ui'
import {
  IconAlert,
  IconEdit,
  IconEye,
  IconHistory,
  IconImport,
  IconPlus,
  IconRefresh,
  IconRoute,
  IconServer,
  IconTrash,
  IconUpload,
} from '../components/icons'
import { OverviewTab } from '../pages/tabs/OverviewTab'
import { ConfigTab } from '../pages/tabs/ConfigTab'
import { ReleasesTab } from '../pages/tabs/ReleasesTab'
import { getSelection, selectGateway, subscribeSelection } from './selection'

/**
 * 三个标签，不是五个。
 *
 * 监听器 / 路由 / 负载均衡器本来各占一个标签，但它们不是三件独立的事——它们是
 * **同一条链路上的三段**，分开看就永远看不出「这条路由到底落在哪个后端上」。
 * 所以合并成一个「配置」，图是主视图，表格是右上角的备选视图。
 */
type TabKey = 'overview' | 'config' | 'releases'

const TABS: Array<{ key: TabKey; label: string; icon: typeof IconServer }> = [
  { key: 'overview', label: '概览', icon: IconServer },
  { key: 'config', label: '配置', icon: IconRoute },
  { key: 'releases', label: '发布历史', icon: IconHistory },
]

export function GatewayApp() {
  const { gateways, loading: listLoading, error: listError, reload: reloadList } = useGatewayList()
  const currentId = useSyncExternalStore(subscribeSelection, getSelection, getSelection)
  const toast = useToast()

  const gateway = useMemo(
    () => gateways.find((g) => g.id === currentId) ?? gateways[0],
    [gateways, currentId],
  )
  const tree = useGatewayTree(gateway?.id)

  // 存着的 id 可能已经被删了：落到第一个实例上，别让窗口空着
  useEffect(() => {
    if (gateway && gateway.id !== currentId) selectGateway(gateway.id)
  }, [gateway, currentId])

  const [tab, setTab] = useState<TabKey>('overview')
  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  // ---- 发布链路状态 ----
  const [preview, setPreview] = useState<RenderPreview | undefined>(undefined)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<Error | undefined>(undefined)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | undefined>(undefined)
  const [result, setResult] = useState<{ title: string; data: PublishResult } | null>(null)

  // ---- 回滚状态 ----
  const [rollbackTarget, setRollbackTarget] = useState<Release | null>(null)
  const [rollbackNeedConfirm, setRollbackNeedConfirm] = useState<string | undefined>(undefined)
  const [rollbackBusy, setRollbackBusy] = useState(false)

  const gatewayId = gateway?.id

  // 换实例时清掉一次性状态，否则会把上一个实例的预览/弹窗带过来
  useEffect(() => {
    setPreview(undefined)
    setPreviewError(undefined)
    setPreviewOpen(false)
    setPublishOpen(false)
    setResult(null)
  }, [gatewayId])

  const loadPreview = useCallback(async () => {
    if (!gatewayId) return
    setPreviewLoading(true)
    setPreviewError(undefined)
    try {
      setPreview(await api.publish.preview(gatewayId))
    } catch (e) {
      setPreviewError(e as Error)
      setPreview(undefined)
    } finally {
      setPreviewLoading(false)
    }
  }, [gatewayId])

  const openPreview = () => {
    setPreviewOpen(true)
    void loadPreview()
  }

  const openPublish = () => {
    setPublishError(undefined)
    setPublishOpen(true)
    void loadPreview()
  }

  const doPublish = async (opts: { force: boolean; confirmRestart: boolean }) => {
    if (!gatewayId) return
    setPublishing(true)
    setPublishError(undefined)
    try {
      const data = await api.publish.publish(gatewayId, opts)
      setPublishOpen(false)
      setResult({ title: data.skipped ? '内容未变化，已跳过推送' : '发布完成', data })
      tree.reload()
      reloadList()
    } catch (e) {
      setPublishError((e as ApiError).message)
    } finally {
      setPublishing(false)
    }
  }

  const doRollback = async (confirmRestart: boolean) => {
    if (!rollbackTarget) return
    setRollbackBusy(true)
    try {
      const data = await api.publish.rollback(rollbackTarget.id, { confirmRestart })
      setRollbackTarget(null)
      setRollbackNeedConfirm(undefined)
      setResult({ title: '回滚完成', data })
      tree.reload()
    } catch (e) {
      const err = e as ApiError
      // 服务端在「需要重启但没确认」时返回 400 且 msg 说明原因：把这句话原样
      // 变成「必须勾选才能继续」的闸门，比前端自己猜什么时候要重启更可靠
      if (err.status === 400 && err.message.includes('重启')) {
        setRollbackNeedConfirm(err.message)
      } else {
        toast.error(err.message)
        setRollbackTarget(null)
      }
    } finally {
      setRollbackBusy(false)
    }
  }

  const doDelete = async () => {
    if (!gateway) return
    try {
      await api.gateway.remove(gateway.id)
      toast.success(`已删除「${gateway.name}」`)
      setDeleteOpen(false)
      selectGateway('')
      reloadList()
    } catch (e) {
      toast.error((e as ApiError).message)
    }
  }

  const counts: Record<TabKey, number | undefined> = {
    overview: undefined,
    config: tree.listeners.length + tree.routes.length + tree.balancers.length,
    releases: tree.releases.length,
  }

  const latest = tree.releases[0]
  const addrSummary = tree.listeners
    .filter((l) => l.enabled)
    .flatMap((l) => describeAddrs(l.addrsJson))
    .slice(0, 2)

  return (
    <div className="gwapp">
      {/* 实例列在上方而不是左侧：窗口可以拉得很矮很宽，左侧栏一竖就把内容挤成一条缝；
          横向一排 chip 在矮窗口里更省地方，也让「切实例」这件事更像切标签 */}
      <div className="gw-top">
        <div className="gw-top-l">
          <span className="gw-top-t">网关实例</span>
          {gateways.length > 0 && <span className="gw-top-n">{gateways.length}</span>}
        </div>

        <div className="gw-tabs">
          {listLoading && gateways.length === 0 && (
            <span className="gw-tab-hint">
              <Spinner size={11} /> 加载中…
            </span>
          )}
          {listError && (
            <button className="gw-tab-hint danger" onClick={reloadList}>
              ! 列表加载失败，点此重试
            </button>
          )}
          {!listLoading && !listError && gateways.length === 0 && (
            <span className="gw-tab-hint">还没有实例</span>
          )}

          {gateways.map((g) => (
            <button
              key={g.id}
              className={cx('gw-tab', g.id === gateway?.id && 'on')}
              onClick={() => selectGateway(g.id)}
              title={`${g.name} · ${g.code} · ${g.consulKey}`}
            >
              <span className={cx('dot', g.enabled ? 'on' : 'off')} />
              <span className="gw-tab-nm">{g.name}</span>
              <span className="gw-tab-code">{g.code}</span>
            </button>
          ))}

          <button
            className="gw-tab gw-tab-add"
            onClick={() => setCreateOpen(true)}
            title="新建网关实例"
          >
            <IconPlus size={12} /> 新建
          </button>
        </div>
      </div>

      <div className="gw-main">
        {!gateway ? (
          <div className="pane">
            {listLoading ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '40px 0', justifyContent: 'center' }}>
                <Spinner size={15} /> <span className="muted">加载网关实例…</span>
              </div>
            ) : (
              <Empty
                title="还没有网关实例"
                description="一个实例 = Consul KV 里的一个键。新建之后可以加监听器、路由与负载均衡器，再发布。"
                action={
                  <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
                    <IconPlus size={13} /> 新建实例
                  </button>
                }
              />
            )}
          </div>
        ) : (
          <div className="pane">
            <div className="pane-head">
              <div style={{ minWidth: 0 }}>
                <div className="pane-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  {gateway.name}
                  <span className="chip">{gateway.code}</span>
                  {gateway.enabled ? (
                    <Badge tone="ok">启用</Badge>
                  ) : (
                    <Badge tone="mute">停用</Badge>
                  )}
                </div>
                <div className="pane-desc">
                  <span className="mono">{gateway.consulKey}</span>
                  <span> · </span>
                  {latest ? `当前 v${latest.version}` : '未发布'}
                  <span> · </span>
                  {tree.listeners.length} 个监听器
                  <span> · </span>
                  {tree.routes.length} 条路由
                  {addrSummary.length > 0 && (
                    <>
                      <span> · </span>
                      <span className="mono">{addrSummary.join(' / ')}</span>
                    </>
                  )}
                  <span> · </span>
                  更新于 {relativeTime(gateway.updateMs)}
                </div>
              </div>

              <div className="pane-actions">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={tree.reload}
                  title="刷新监听器/路由/发布历史"
                >
                  <IconRefresh size={13} className={tree.loading ? 'animate-spin' : ''} />
                </button>
                <button className="btn btn-sm" onClick={() => setEditOpen(true)}>
                  <IconEdit size={13} /> 编辑
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => setImportOpen(true)}
                  title="把线上正在跑的 TOML 拆成结构化配置落库（接管线上网关的第一步）"
                >
                  <IconImport size={13} /> 导入
                </button>
                <button className="btn btn-sm" onClick={openPreview}>
                  <IconEye size={13} /> 渲染预览
                </button>
                <button className="btn btn-primary btn-sm" onClick={openPublish}>
                  <IconUpload size={13} /> 发布
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ color: 'var(--t3)' }}
                  onClick={() => setDeleteOpen(true)}
                  title="删除实例"
                >
                  <IconTrash size={13} />
                </button>
              </div>
            </div>

            <div className="seg">
              {TABS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  className={cx('seg-item', tab === key && 'on')}
                  onClick={() => setTab(key)}
                >
                  <Icon size={13} />
                  {label}
                  {counts[key] !== undefined && counts[key]! > 0 && <span className="n">{counts[key]}</span>}
                </button>
              ))}
            </div>

            {/* 库里一条监听器都没有，等于「这个实例还没被接管」。
                这时候点发布不是「发布空配置」，是「把线上正在跑的路由全删掉」——
                必须在这一屏就拦住，不能等用户自己发现。 */}
            {!tree.loading && !tree.error && tree.listeners.length === 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-[color-mix(in_srgb,var(--warn)_38%,transparent)] bg-warn-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-ink">
                <IconAlert size={14} />
                <span>
                  这个实例在库里还没有任何监听器和路由。
                  <b>现在点发布会把线上正在跑的配置覆盖成空配置</b>
                  ——先「导入」一份线上 TOML，把库里的数据对齐。
                </span>
                <button
                  className="btn btn-sm ml-auto shrink-0"
                  onClick={() => setImportOpen(true)}
                >
                  <IconImport size={13} /> 导入现有 TOML
                </button>
              </div>
            )}

            {tree.error && (
              <div
                style={{
                  marginBottom: 12,
                  padding: '8px 11px',
                  borderRadius: 8,
                  background: 'var(--danger-soft)',
                  color: 'var(--danger)',
                  fontSize: 11.5,
                }}
              >
                加载配置失败：{tree.error.message}
                <button
                  style={{ marginLeft: 8, textDecoration: 'underline', color: 'inherit' }}
                  onClick={tree.reload}
                >
                  重试
                </button>
              </div>
            )}

            {tab === 'overview' && (
              <OverviewTab gateway={gateway} tree={tree} onPreview={openPreview} />
            )}
            {tab === 'config' && (
              <ConfigTab
                gateway={gateway}
                gatewayId={gateway.id}
                listeners={tree.listeners}
                routes={tree.routes}
                balancers={tree.balancers}
                loading={tree.loading}
                onChanged={tree.reload}
                onEditGateway={() => setEditOpen(true)}
                published={
                  latest ? { version: latest.version, checksum: latest.checksum } : undefined
                }
              />
            )}
            {tab === 'releases' && (
              <ReleasesTab
                releases={tree.releases}
                loading={tree.loading}
                onRollback={(release) => {
                  setRollbackNeedConfirm(undefined)
                  setRollbackTarget(release)
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* 新建 */}
      <GatewayForm
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={(saved) => {
          reloadList()
          selectGateway(saved.id)
        }}
      />

      {/* 编辑 */}
      {gateway && (
        <GatewayForm
          open={editOpen}
          gateway={gateway}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            reloadList()
            tree.reload()
          }}
        />
      )}

      {gateway && (
        <ImportDialog
          open={importOpen}
          gateway={gateway}
          onClose={() => setImportOpen(false)}
          onImported={() => {
            reloadList()
            tree.reload()
          }}
        />
      )}

      {gateway && (
        <ConfirmDialog
          open={deleteOpen}
          title="删除网关实例"
          danger
          confirmText="删除"
          description={
            <>
              将删除 <b>{gateway.name}</b> 及其全部监听器、路由、负载均衡器与发布记录。
              Consul KV 里已经推上去的配置<b>不会被删除</b>——网关会继续按那份配置运行，
              直到有人写入新的内容。
            </>
          }
          onCancel={() => setDeleteOpen(false)}
          onConfirm={doDelete}
        />
      )}

      <PreviewDrawer
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        preview={preview}
        loading={previewLoading}
        error={previewError}
        onPublish={() => {
          setPreviewOpen(false)
          openPublish()
        }}
      />

      <PublishDialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        preview={preview}
        loading={previewLoading}
        previewError={previewError}
        busy={publishing}
        error={publishError}
        onConfirm={doPublish}
      />

      <ConfirmDialog
        open={Boolean(rollbackTarget)}
        title={`回滚到 v${rollbackTarget?.version ?? ''}`}
        confirmText="确认回滚"
        busy={rollbackBusy}
        description={
          <>
            把 v{rollbackTarget?.version} 的 <b>content 原样</b>再推一次，生成一个新版本。
            注意：<span style={{ color: 'var(--t1)' }}>回滚只改 Consul KV，不改库里的配置行</span>
            ——下次发布会把库里现在的配置重新推上去，等于撤销这次回滚。
          </>
        }
        requireCheck={rollbackNeedConfirm}
        onCancel={() => {
          setRollbackTarget(null)
          setRollbackNeedConfirm(undefined)
        }}
        onConfirm={() => doRollback(Boolean(rollbackNeedConfirm))}
      />

      <ResultDialog
        open={Boolean(result)}
        onClose={() => setResult(null)}
        title={result?.title ?? ''}
        result={result?.data}
      />
    </div>
  )
}
