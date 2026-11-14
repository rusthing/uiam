/**
 * 接口速查：把 api.ts 里那十几个端点摆成一张表。
 *
 * 这张表不是文档的替代品，是**排错时的第一现场**：调不通的时候要能立刻确认
 * 路径前缀、查询参数和返回信封长什么样，而不是回去翻代码。
 * 所有路径都是相对当前源站的，开发态由 Vite 代理到 uiam-svr。
 */
import { useState } from 'react'

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

interface Row {
  group: string
  method: Method
  path: string
  desc: string
}

const ROWS: Row[] = [
  { group: '网关实例', method: 'GET', path: '/uiam/gateway/list', desc: '列表，可加 ?enabled=true 过滤' },
  { group: '网关实例', method: 'GET', path: '/uiam/gateway/{id}', desc: '按 id 取单条' },
  { group: '网关实例', method: 'POST', path: '/uiam/gateway', desc: '新建（id 留空）' },
  { group: '网关实例', method: 'PUT', path: '/uiam/gateway', desc: '修改（body 带 id）' },
  { group: '网关实例', method: 'DELETE', path: '/uiam/gateway/{id}', desc: '删除，不动 KV' },
  { group: '监听器', method: 'GET', path: '/uiam/gateway-listener/list?gatewayId=', desc: '按实例取监听器' },
  { group: '监听器', method: 'POST', path: '/uiam/gateway-listener', desc: 'kind 1=Http 2=Tcp' },
  { group: '监听器', method: 'PUT', path: '/uiam/gateway-listener', desc: '改地址属于结构性变更' },
  { group: '监听器', method: 'DELETE', path: '/uiam/gateway-listener/{id}', desc: '删监听器（连带路由）' },
  { group: '路由', method: 'GET', path: '/uiam/gateway-route/list?listenerId=', desc: '按监听器取路由' },
  { group: '路由', method: 'POST', path: '/uiam/gateway-route', desc: 'sortNo 小的先匹配' },
  { group: '路由', method: 'PUT', path: '/uiam/gateway-route', desc: '修改匹配器或目标' },
  { group: '路由', method: 'DELETE', path: '/uiam/gateway-route/{id}', desc: '删路由' },
  { group: '负载均衡', method: 'GET', path: '/uiam/gateway-balancer/list?gatewayId=', desc: '按实例取 LB' },
  { group: '负载均衡', method: 'POST', path: '/uiam/gateway-balancer', desc: 'name 被路由按名引用' },
  { group: '负载均衡', method: 'PUT', path: '/uiam/gateway-balancer', desc: '改配置' },
  { group: '负载均衡', method: 'DELETE', path: '/uiam/gateway-balancer/{id}', desc: '仍被引用时发布会拒绝' },
  { group: '发布', method: 'GET', path: '/uiam/gateway/render-preview/{id}', desc: '只渲染，不落库不推 KV' },
  { group: '发布', method: 'POST', path: '/uiam/gateway/publish/{id}', desc: 'body: {force, confirmRestart}' },
  { group: '发布', method: 'POST', path: '/uiam/gateway/rollback/{releaseId}', desc: 'content 原样重推' },
  { group: '发布历史', method: 'GET', path: '/uiam/gateway-release/list?gatewayId=', desc: '版本号倒序由前端排' },
  { group: '发布历史', method: 'GET', path: '/uiam/gateway-release/{id}', desc: '取完整 TOML 内容' },
]

const METHOD_TONE: Record<Method, string> = {
  GET: 'blue',
  POST: 'green',
  PUT: 'amber',
  DELETE: 'red',
}

export function ApiApp() {
  const [kw, setKw] = useState('')
  const k = kw.trim().toLowerCase()
  const rows = ROWS.filter(
    (r) => !k || r.path.toLowerCase().includes(k) || r.desc.toLowerCase().includes(k) || r.group.includes(k),
  )

  return (
    <div className="pane">
      <div className="pane-head">
        <div>
          <div className="pane-title">接口速查</div>
          <div className="pane-desc">
            uiam-svr 对外接口 · 统一信封 <span className="mono">{'{result, msg, timestamp, extra}'}</span> ·
            <span className="mono"> result !== 1</span> 也是失败
          </div>
        </div>
        <div className="pane-actions">
          <input
            className="input"
            style={{ width: 190, height: 26 }}
            placeholder="搜索路径或说明"
            value={kw}
            onChange={(e) => setKw(e.target.value)}
          />
        </div>
      </div>

      <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 300px)' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 76 }}>方法</th>
              <th style={{ width: 380 }}>路径</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.method} ${r.path}`}>
                <td>
                  <span className={`chip ${METHOD_TONE[r.method]}`}>{r.method}</span>
                </td>
                <td className="mono" style={{ fontSize: 11.5 }}>
                  {r.path}
                </td>
                <td>
                  <span className="muted" style={{ color: 'var(--t2)' }}>
                    {r.desc}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} style={{ textAlign: 'center', padding: 24, color: 'var(--t3)' }}>
                  没有匹配的接口
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="hint" style={{ marginTop: 10 }}>
        列表接口都支持 <span className="mono">/search</span> 变体（字段过滤 + 分页），字段参数形如
        <span className="mono"> field-1=name&amp;field-op=like&amp;field-ic=1</span>，全局参数是
        <span className="mono"> _page / _size / _orderBy / _keyword</span>。
      </p>
    </div>
  )
}
