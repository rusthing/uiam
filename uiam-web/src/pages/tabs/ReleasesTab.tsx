/**
 * 发布历史：只增不改，线上恒等于版本号最大的那版。
 *
 * 回滚不是「把指针拨回去」，而是**把某版内容原样再推一次并生成新版本**。
 * 界面上的说法要跟这个一致，否则用户会以为回滚之后还能「回到未来」。
 */
import { useState } from 'react'
import { formatTime, relativeTime, shortChecksum } from '../../lib/format'
import type { Release } from '../../lib/types'
import { CodeView } from '../../components/CodeView'
import { Badge, Drawer, Empty, Section, Spinner } from '../../components/ui'
import { IconEye, IconUndo } from '../../components/icons'

export function ReleasesTab({
  releases,
  loading,
  onRollback,
}: {
  releases: Release[]
  loading: boolean
  onRollback: (release: Release) => void
}) {
  const [viewing, setViewing] = useState<Release | null>(null)
  const latest = releases[0]

  return (
    <>
      <Section
        title="发布历史"
        description="每次发布 / 回滚都产生一条新版本；content 是当时推送出去的完整 TOML。"
      >
        {loading ? (
          <div className="flex items-center gap-2 px-5 py-10 text-[13px] text-ink-mute">
            <Spinner size={14} /> 加载中…
          </div>
        ) : releases.length === 0 ? (
          <Empty
            title="还没有发布记录"
            description="点右上角「发布」把当前配置推到 Consul KV，就会产生 v1。"
          />
        ) : (
          <div className="table-wrap m-4">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="w-[100px] whitespace-nowrap">版本</th>
                  <th className="w-[110px]">摘要</th>
                  <th className="w-[90px]">状态</th>
                  <th>发布者</th>
                  <th className="w-[250px] whitespace-nowrap">时间</th>
                  <th className="w-[130px] text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {releases.map((release) => {
                  const isLatest = latest?.id === release.id
                  return (
                    <tr key={release.id}>
                      <td>
                        <span className="flex items-center gap-1.5 whitespace-nowrap">
                          <Badge tone={isLatest ? 'brand' : 'mute'}>v{release.version}</Badge>
                          {isLatest && <span className="text-[11px] text-brand">线上</span>}
                        </span>
                      </td>
                      <td className="mono text-[11.5px] text-ink-soft" title={release.checksum}>
                        {shortChecksum(release.checksum)}
                      </td>
                      <td>
                        {release.pushed ? (
                          <Badge tone="ok">已推送</Badge>
                        ) : (
                          <Badge tone="warn">未推送</Badge>
                        )}
                      </td>
                      <td className="text-ink-soft">#{release.createrId}</td>
                      <td className="whitespace-nowrap text-[12px] text-ink-soft">
                        {formatTime(release.pushedMs ?? release.createMs)}
                        <span className="ml-1.5 text-ink-mute">
                          {relativeTime(release.pushedMs ?? release.createMs)}
                        </span>
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <button
                            className="btn btn-ghost btn-sm !px-1.5"
                            onClick={() => setViewing(release)}
                            title="查看内容"
                          >
                            <IconEye size={13} />
                          </button>
                          <button
                            className="btn btn-sm !px-2"
                            onClick={() => onRollback(release)}
                            disabled={isLatest}
                            title={isLatest ? '这已经是线上版本' : '把这个版本原样重推一次'}
                          >
                            <IconUndo size={13} /> 回滚
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Drawer
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        width={820}
        title={viewing ? `v${viewing.version} 的配置内容` : ''}
        subtitle={
          viewing && (
            <span className="flex flex-wrap items-center gap-2">
              <span className="mono">{viewing.checksum}</span>
              <span>·</span>
              <span>{formatTime(viewing.pushedMs ?? viewing.createMs)}</span>
              {viewing.pushed ? (
                <Badge tone="ok">已推送</Badge>
              ) : (
                <Badge tone="warn">未推送</Badge>
              )}
            </span>
          )
        }
        footer={
          <>
            <button className="btn" onClick={() => setViewing(null)}>
              关闭
            </button>
            {viewing && latest?.id !== viewing.id && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  const target = viewing
                  setViewing(null)
                  onRollback(target)
                }}
              >
                <IconUndo size={13} /> 回滚到这一版
              </button>
            )}
          </>
        }
      >
        {viewing && (
          <div className="p-5">
            <CodeView code={viewing.content} maxHeight={9999} />
          </div>
        )}
      </Drawer>
    </>
  )
}
