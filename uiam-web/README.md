# uiam-web

uiam 管理面前端：网关配置的结构化编辑、渲染预览、发布与回滚。

React 19 + Vite 8 + React Router 7 + Tailwind 4。没有 UI 组件库——控件只有十来种，
自己写反而能把业务约束（比如「要重启才能发的变更必须勾选确认」）直接做进组件。

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

## 页面结构

| 路由 | 内容 |
|---|---|
| `/` | 实例列表（没有实例时就是新建入口） |
| `/gateway/:id` | 概览 |
| `/gateway/:id?tab=listeners` | 监听器（HTTP / TCP，地址与 TLS 路径） |
| `/gateway/:id?tab=routes` | 路由（按监听器分组，顺序即语义） |
| `/gateway/:id?tab=balancers` | 负载均衡器（名字被路由引用） |
| `/gateway/:id?tab=releases` | 发布历史、查看内容、回滚 |

标签放在 URL 里，是为了「把某个实例的路由页发给同事」这件事成立，刷新也不会退回概览。

## 接口约定

响应信封是 `{ result, msg, timestamp, extra }`，**`result !== 1` 也算失败**——
只看 HTTP 状态会把业务失败静默吞掉。`msg` 是给人看的原因（比如「本次发布会重启网关」），
前端不要自己编一句「操作失败」把它盖掉。

`u64` 字段（`id` / `gatewayId` / `listenerId`）被序列化成**字符串**防 JS 精度丢失，
不要当数字运算。

## 目录

```
src/
├── lib/
│   ├── api.ts        请求层：X-User-Id、信封解包、错误上抛
│   ├── types.ts      接口契约（字段名来自 #[crud_dto] / #[vo] 的 camelCase）
│   ├── format.ts     时间、JSON 容错解析、matcher/to 摘要
│   ├── theme.ts      两态主题 + 圆形扩散（圆心 = 图标中心）
│   └── useAsync.ts   极简取数 hook
├── state/
│   ├── GatewayList.tsx   实例列表（侧边栏与主区共享）
│   └── useGatewayTree.ts 一个实例的监听器/路由/LB/发布历史
├── components/       Shell、弹窗、抽屉、Toast、JSON 编辑器、代码视图
└── pages/            首页、网关工作区、五个标签页
```

## 主题

只有 `light` / `dark` 两态，**没有「跟随系统」**。系统偏好只在 localStorage 没有记录时
决定初值，之后系统怎么变都不影响——否则用户手动选过的主题会在某天夜里被覆盖。

切换用 `document.startViewTransition` + `clip-path: circle(0 → r at 图标中心)`：
圆心取按钮的 `getBoundingClientRect()` 中点，不是鼠标点、也不是屏幕中心。
不支持或用户要求减少动效时退回整页 CSS 过渡。

## 一期已知取舍

- **没有登录**：操作者 ID 在侧边栏底部手填，只用于 `X-User-Id` 与审计
- **列表接口带 `content`**：发布历史每行都拖着整份 TOML，一期接受（后续补摘要接口是加字段）
- **diff 是行级的**：`src/lib/diff.ts` 用 LCS 现算，够看清「这次改了哪几行」，
  但不做词级最小化，也不跨版本三方合并
