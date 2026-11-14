/**
 * 应用注册表（元数据）。
 *
 * 只放「桌面上要用的」信息：名字、图标渐变、默认窗口尺寸。真正的窗口内容是
 * React 组件，在 `apps/index.tsx` 里按 id 分发——外壳（Dock / 启动台 / 窗口）
 * 只依赖这份元数据，不会因为某个业务页面改结构而跟着动。
 *
 * 这里**只有真正接了后端的能力**：uiam-svr 目前实现的是网关配置这一条链路，
 * 所以桌面上不会出现「用户中心」「审计日志」这类点开是空壳的假应用。
 */
export interface AppMeta {
  id: string
  name: string
  desc: string
  /** 图标渐变起止色 */
  c1: string
  c2: string
  /** 默认窗口尺寸，实际开窗时会按视口裁一下 */
  w: number
  h: number
}

export const APPS: AppMeta[] = [
  {
    id: 'gateway',
    name: '网关配置',
    desc: 'Consul KV 网关配置的编辑、发布与回滚',
    c1: '#6f8cf7',
    c2: '#2f4bc0',
    w: 1120,
    h: 680,
  },
  {
    id: 'api',
    name: '接口速查',
    desc: 'uiam-svr 对外提供的全部接口',
    c1: '#2ad1d6',
    c2: '#0a8a99',
    w: 860,
    h: 600,
  },
  {
    id: 'settings',
    name: '系统设置',
    desc: '外观、操作者与桌面布局',
    c1: '#9aa0a6',
    c2: '#4a4f55',
    w: 760,
    h: 560,
  },
  {
    id: 'about',
    name: '关于 uiam',
    desc: '版本、设计约束与生效路径',
    c1: '#4facfe',
    c2: '#0a6ed1',
    w: 640,
    h: 500,
  },
]

export const APP_MAP: Record<string, AppMeta> = Object.fromEntries(
  APPS.map((a) => [a.id, a]),
)

/** Dock 固定栏的默认成员；用户可以右键改，存在 localStorage */
export const DEFAULT_PINNED = ['gateway', 'api', 'settings', 'about']
