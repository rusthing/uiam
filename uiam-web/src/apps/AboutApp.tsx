/**
 * 关于：版本 + 这个系统最重要的那条约束。
 *
 * 把「生效路径是单向的」写在关于里，是因为它会决定排障方向：配置没生效时，
 * 先看网关的 /health 里 config-state，而不是怀疑 uiam 没保存——uiam 只负责把
 * 内容写进 Consul KV，转发路径上根本没有它。
 */
export function AboutApp() {
  return (
    <div className="pane">
      <div className="pane-head">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div
            className="tile"
            style={{
              width: 52,
              height: 52,
              borderRadius: '24%',
              ['--c1' as string]: '#4facfe',
              ['--c2' as string]: '#0a6ed1',
              fontSize: 22,
              fontWeight: 700,
            }}
          >
            U
          </div>
          <div>
            <div className="pane-title">uiam</div>
            <div className="pane-desc">统一身份与网关管理面 · 版本 0.1.0</div>
          </div>
        </div>
      </div>

      <div className="sec-label">生效路径</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
        <span className="chip blue">uiam 编辑</span>
        <span style={{ color: 'var(--t3)' }}>→</span>
        <span className="chip">渲染 TOML</span>
        <span style={{ color: 'var(--t3)' }}>→</span>
        <span className="chip green">写 Consul KV</span>
        <span style={{ color: 'var(--t3)' }}>→</span>
        <span className="chip amber">gatex 读 KV</span>
        <span style={{ color: 'var(--t3)' }}>→</span>
        <span className="chip">热更新转发规则</span>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        单向，没有回执。uiam 挂了网关照常转发；配置没生效先去网关的
        <span className="mono"> /health</span> 看 <span className="mono">config-state</span>。
      </p>

      <div className="sec-label">两条会咬人的约束</div>
      <ul
        style={{
          margin: 0,
          paddingLeft: 18,
          listStyle: 'disc',
          fontSize: 12,
          lineHeight: 1.75,
          color: 'var(--t2)',
        }}
      >
        <li>
          改监听地址、增删监听器属于<b>结构性变更</b>，发布会要求确认重启——所以确认框里
          会明写「会断开现有连接」，而不是发布失败后才解释。
        </li>
        <li>
          回滚只改 Consul KV、<b>不改库里的配置行</b>；下次发布会把库里当前的配置重新推上去，
          等于把回滚撤销。要真正回到旧配置，得把旧内容写回库里再发布。
        </li>
      </ul>

      <div className="sec-label">技术栈</div>
      <p className="hint" style={{ margin: 0 }}>
        React 19 + Vite + Tailwind 4，无组件库；窗口、Dock、桌面组件全部手写。
        外观两态（浅色/深色），切换走 View Transitions 的圆形扩散，圆心固定在菜单栏的外观图标上。
      </p>
    </div>
  )
}
