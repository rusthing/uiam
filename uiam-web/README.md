# uiam-web

uiam 管理面前端：**macOS 桌面式**外壳 + 网关配置的结构化编辑、渲染预览、发布与回滚。

视觉与结构严格对齐定稿原型 [`prototype/a-macos.html`](prototype/a-macos.html)
（macOS 26 Tahoe / Liquid Glass）：壁纸 + 菜单栏 + 组件网格 + Dock + 启动台 + 可拖拽窗口。
业务内容住在窗口里，不是「侧边栏 + 标签页」的后台。

React 19 + Vite 8 + Tailwind 4。没有 UI 组件库，也没有路由库——窗口是内存状态，
关掉就没了，URL 里塞不下「三个窗口叠着、哪个在最上面」这种事。

## 跑起来

```bash
npm install
npm run dev      # http://127.0.0.1:5180
```

开发服务器把 `/uiam` 反代到 `http://127.0.0.1:9002`（`vite.config.ts`），
所以本地不需要给 uiam-svr 配 CORS，也不需要在前端写 baseURL。

```bash
npm run build    # 产物在 dist/，可直接交给网关做静态托管
npm run typecheck
```

## 桌面

| 位置 | 内容 |
|---|---|
| 菜单栏左 | 品牌、当前应用名、文件/编辑/显示/前往/窗口/帮助 |
| 菜单栏右 | **编辑桌面**、外观图标（主题切换，动画圆心）、状态图标、时钟 |
| 组件网格 | 4 列 × 132px 行高，8 个组件，可拖拽排序 / 切尺寸 / 移除 / 添加，布局存 localStorage |
| Dock | 启动台 + 固定应用 + 临时应用（开着但没固定）+ 废纸篓；右键可固定/取消、关窗口 |
| 启动台 | 全屏毛玻璃 + 搜索（匹配名字与描述） |
| 窗口 | 交通灯（关/最小化/缩放）、标题栏拖动、双击标题栏最大化、点 Dock 还原 |

窗口里的应用：

| 应用 | 内容 |
|---|---|
| 网关配置 | Finder 双栏：左实例列表（含新建），右「概览 / 监听器 / 路由 / 负载均衡 / 发布历史」分段标签 |
| 接口速查 | uiam-svr 全部接口的路径、方法与说明，可搜索 |
| 系统设置 | 外观、操作者 ID、桌面布局、窗口列表 |
| 关于 uiam | 版本、生效路径、两条会咬人的约束 |

**桌面组件没有假数据**：实例数、启用数、实例状态、最近发布、待推送、待处理，
全部由「网关列表 + 发布历史」两份真实数据推导。原型上的「在线用户 128」这类
为了看排版的数字没有搬过来——桌面上第一个数字就错，比空着更糟。

## 接口约定

响应信封是 `{ result, msg, timestamp, extra }`，**`result !== 1` 也算失败**——
只看 HTTP 状态会把业务失败静默吞掉。`msg` 是给人看的原因（比如「本次发布会重启网关」），
前端不要自己编一句「操作失败」把它盖掉。

`u64` 字段（`id` / `gatewayId` / `listenerId`）被序列化成**字符串**防 JS 精度丢失，
不要当数字运算。

## 目录

```
src/
├── apps/            窗口里的应用
│   ├── meta.ts        应用元数据（名字/渐变/默认窗口尺寸）——外壳只依赖它
│   ├── GatewayApp.tsx 网关配置：Finder 双栏 + 分段标签 + 发布/回滚链路
│   ├── ApiApp.tsx     接口速查
│   ├── SettingsApp.tsx / AboutApp.tsx
│   ├── selection.ts   当前选中实例（跨组件树的模块级 store）
│   └── index.tsx      id → 组件分发
├── shell/           桌面外壳
│   ├── state.tsx        窗口/Dock/编辑态/启动台
│   ├── Desktop.tsx      壁纸 + 组件网格 + 窗口层
│   ├── MenuBar.tsx / Dock.tsx / Launchpad.tsx / Window.tsx
│   ├── widgets.tsx      8 个桌面组件
│   ├── useWidgetLayout.ts 布局定义与 localStorage
│   └── overview.tsx     组件共用的聚合数据
├── lib/             api / types / format / diff / theme
├── state/           GatewayList（实例列表）、useGatewayTree（一棵子树）
├── components/      弹窗、抽屉、Toast、JSON 编辑器、代码视图、diff
└── pages/tabs/      网关窗口里的五个标签页视图
```

## 主题

只有 `light` / `dark` 两态，**没有「跟随系统」**。系统偏好只在 localStorage 没有记录时
决定初值，之后系统怎么变都不影响——否则用户手动选过的主题会在某天夜里被覆盖。

切换用 `document.startViewTransition` + `clip-path: circle(0 → r at 图标中心)`：
圆心取菜单栏外观图标的 `getBoundingClientRect()` 中点，不是鼠标点、也不是屏幕中心。
不支持或用户要求减少动效时退回整页 CSS 过渡。

## 一期已知取舍

- **没有登录**：操作者 ID 在「系统设置」里手填，只用于 `X-User-Id` 与审计
- **只有网关这一条链路是真接后端的**：用户/角色/应用/会话/审计还没实现，
  所以桌面上不出现这些应用，不做点开是空壳的假图标
- **列表接口带 `content`**：发布历史每行都拖着整份 TOML，一期接受
- **diff 是行级的**：`src/lib/diff.ts` 用 LCS 现算，不做词级最小化
- **组件布局只存本机**：换设备/换浏览器不跟随，二期接后端配置中心再统一
