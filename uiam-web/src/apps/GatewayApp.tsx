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
import { PublishDialog, PreviewDrawer, ResultDialog } from '../components/Publish'
import { useToast } from '../components/Toast'
import { Badge, cx, Empty, Spinner } from '../components/ui'
import {
  IconEdit,
  IconEye,
  IconHistory,
  IconPlus,
  IconRefresh,
  IconRoute,
  IconScale,
  IconServer,
  IconTrash,
  IconUpload,
} from '../components/icons'
import { OverviewTab } from '../pages/tabs/OverviewTab'
import { ListenersTab } from '../pages/tabs/ListenersTab'
import { RoutesTab } from '../pages/tabs/RoutesTab'
import { BalancersTab } from '../pages/tabs/BalancersTab'
import { ReleasesTab } from '../pages/tabs/ReleasesTab'
import { getSelection, selectGateway, subscribeSelection } from './selection'

type TabKey = 'overview' | 'listeners' | 'routes' | 'balancers' | 'releases'

const TABS: Array<{ key: TabKey; label: string; icon: typeof IconServer }> = [
  { key: 'overview', label: '概览', icon: IconServer },
  { key: 'listeners', label: '监听器', icon: IconServer },
  { key: 'routes', label: '路由', icon: IconRoute },
  { key: 'balancers', label: '负载均衡', icon: IconScale },
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
    listeners: tree.listeners.length,
    routes: tree.routes.length,
    balancers: tree.balancers.length,
    releases: tree.releases.length,
  }

  const latest = tree.releases[0]
  const addrSummary = tree.listeners
    .filter((l) => l.enabled)
    .flatMap((l) => describeAddrs(l.addrsJson))
    .slice(0, 2)

  return (
    <div className="finder">
      <aside className="sidebar">
        <div className="side-group">
          <div className="side-title">
            <span>网关实例 {gateways.length > 0 && `· ${gateways.length}`}</span>
            <button
              className="btn btn-ghost btn-sm"
              style={{ height: 18, padding: '0 4px' }}
              onClick={() => setCreateOpen(true)}
              title="新建网关实例"
            >
              <IconPlus size={12} />
            </button>
          </div>

          {listLoading && gateways.length === 0 && (
            <div className="side-item">
              <Spinner size={12} /> <span className="sub">加载中…</span>
            </div>
          )}
          {listError && (
            <button className="side-item" onClick={reloadList}>
              <span className="ic">!</span>
              <span className="nm" style={{ color: 'var(--danger)' }}>
                列表加载失败，点此重试
              </span>
            </button>
          )}

          {gateways.map((g) => (
            <button
              key={g.id}
              className={cx('side-item', g.id === gateway?.id && 'active')}
              onClick={() => selectGateway(g.id)}
              title={`${g.code} · ${g.consulKey}`}
            >
              <span className="ic">
                <span className={cx('dot', g.enabled ? 'on' : 'off')} />
              </span>
              <span className="nm" style={{ flex: 1 }}>
                {g.name}
                <span className="sub" style={{ display: 'block' }}>
                  {g.code}
                </span>
              </span>
            </button>
          ))}

          {!listLoading && !listError && gateways.length === 0 && (
            <div className="side-item">
              <span className="sub">还没有实例，点上面的 + 新建</span>
            </div>
          )}
        </div>
      </aside>

      <div className="finder-main">
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
            {tab === 'listeners' && (
              <ListenersTab
                gatewayId={gateway.id}
                listeners={tree.listeners}
                routes={tree.routes}
                loading={tree.loading}
                onChanged={tree.reload}
              />
            )}
            {tab === 'routes' && (
              <RoutesTab
                listeners={tree.listeners}
                routes={tree.routes}
                loading={tree.loading}
                onChanged={tree.reload}
              />
            )}
            {tab === 'balancers' && (
              <BalancersTab
                gatewayId={gateway.id}
                balancers={tree.balancers}
                routes={tree.routes}
                loading={tree.loading}
                onChanged={tree.reload}
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
