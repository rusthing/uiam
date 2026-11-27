# uiam-web

uiam 管理面前端：**macOS 桌面式**外壳 + 网关配置的结构化编辑、渲染预览、发布与回滚。

原型 [`prototype/a-macos.html`](prototype/a-macos.html)（macOS 26 Tahoe）是结构基线；
桌面组件现在按 **macOS 27 Golden Gate** 的小组件规范实现：Liquid Glass 通透度滑块、
图标与小组件样式（默认 / 透明 / 色调）、调暗桌面小组件、system family 尺寸族、
小组件中心与编辑态。业务内容住在窗口里，不是「侧边栏 + 标签页」的后台。

顶栏不是仿 macOS 的苹果菜单：左侧是**可配置的站点图标 + 标题**，右侧只留真正有
行为的「编辑桌面」、外观切换、全屏与时钟。

React 19 + Vite 8 + Tailwind 4。没有 UI 组件库，也没有路由库——窗口是内存状态，
关掉就没了，URL 里塞不下「三个窗口叠着、哪个在最上面」这种事。

## 跑起来

```bash
npm install
npm run dev      # http://127.0.0.1:5180
```

开发服务器把 `/uiam` 反代到 `http://127.0.0.1:9002`（`vite.config.ts`），
所以本地不需要给 uiam-svr 配 CORS，也不需要在前端写 baseURL。

接口前缀只有一个来源：`.env.*` 里的 `VITE_API_BASE`，`request` 里拼一次
（见 `src/lib/api.ts` 文件头那张对照表）。开发默认留空，生产默认 `/uiam-svr`
——**它是网关上的服务名段，不是 uiam-svr 的内部前缀**，网关剥掉这一段之后
uiam-svr 收到的仍是 `/uiam/gateway/list`。改生产值必须同时在网关上加同名前缀路由，
否则浏览器打出去的是一个网关不认识的路径。

```bash
npm run build    # 产物在 dist/，可直接交给网关做静态托管
npm run typecheck
```

## 桌面

| 位置 | 内容 |
|---|---|
| 菜单栏左 | 站点图标 + 站点标题（可配置，点开系统设置） |
| 菜单栏右 | **编辑桌面**、外观图标（主题切换，动画圆心）、**全屏**（整页进全屏，再点一次或 Esc 退出）、时钟 |
| 组件网格 | 正方形定宽单元 `--wg-unit`，small(1×1) / medium(2×1) / large(2×2) / XL(4×2)；8 个组件可拖拽、改尺寸、移除、从小组件中心添加 |
| 编辑态 | 左上「−」移除、右下尺寸手柄、壁纸右键「编辑小组件」、小组件中心（搜索 / 分类 / 预览 / 尺寸 / 描述 / 完成） |
| 小组件中心 | 卡片可**拖到桌面指定位置**（蓝色虚线落点预览，松手吸附网格）；紧凑排布插到落点组件之前，自由摆放按网格坐标定位。也可点「添加」追加到末尾 |
| 自由摆放 | 设置页开关；开启后组件带网格坐标，拖动吸附，关闭时拖的是顺序 |
| Dock | 启动台 + 固定应用 + 临时栏（开着但没固定的，外加最近关闭的最多 3 个；第 4 个关掉时挤掉最早关的，点图标重新拉起）+ 最右侧的**回到桌面**（隔一条线，不参与重排；点一次收起所有窗口，再点一次还原，自己最小化的窗口不跟着还原）；右键可固定/取消、关窗口 |
| 启动台 | 全屏毛玻璃 + 搜索（匹配名字与描述） |
| 窗口 | 交通灯（关/最小化/缩放）、标题栏拖动、双击标题栏最大化、点 Dock 还原、**八向边缘拖拽改大小**（下限 460×280，最大化时禁用）；交通灯右侧有**「在新页面打开」**（仅注册了 `url` 的联邦应用显示，会把窗口内当前路由拼进独立地址，其余四个内置应用没有独立页面故不显示）；开场 `winIn` 缩放淡入、关窗前 `winOut` 退场后再卸载、最小化朝 Dock 缩下去（`winMin`），缩放/还原是 0.24s 几何过渡（拖拽/改大小时临时关掉）。`prefers-reduced-motion` 下全部无效 |

**「全屏」是整页全屏，不是窗口最大化**：点菜单栏右的全屏按钮走 Fullscreen API，让
桌面（顶栏、窗口、Dock）铺满整块显示器、浏览器自己的标题栏与地址栏让位；窗口的
「最大化」只是把一扇窗放大到桌面可视区，两者互不影响。按钮图标跟着
`document.fullscreenElement` 走，所以按钮、Esc、系统把全屏切走三条路径都不会让
图标和屏幕对不上；浏览器不允许网页全屏时（iframe 权限策略、老浏览器）弹一句提示，
用 ⌃⌘F / F11 也能达到同样效果。

窗口里的应用：

| 应用 | 内容 |
|---|---|
| 网关配置 | **顶部一排实例 chip**（横向可滚，含新建）+ 下方整宽内容区；「概览 / 配置 / 发布历史」分段标签；配置页默认是**整条链路的图**，右上角可切表格 |
| 接口速查 | uiam-svr 全部接口的路径、方法与说明，可搜索 |
| 系统设置 | 外观、操作者 ID、桌面布局、窗口列表 |
| 关于 uiam | 版本、生效路径、两条会咬人的约束 |

**桌面组件没有假数据**：实例数、启用数、实例状态、最近发布、待推送、待处理，
全部由「网关列表 + 发布历史」两份真实数据推导。原型上的「在线用户 128」这类
为了看排版的数字没有搬过来——桌面上第一个数字就错，比空着更糟。

## 网关配置：一张图看完整条链路

监听器 / 路由 / 负载均衡器本来各占一个标签页，但它们不是三件独立的事——它们是
**同一条链路上的三段**。分开看就永远回答不了「这条路由最后落到哪个后端地址上」。
所以合并成一个「配置」标签，**默认是图**，右上角可切回表格。

四列是固定的，带列标题（`监听器` / `路由 · 按顺序匹配，命中即停` / `目标` / `后端`）：

```
 监听器              路由                        目标                  后端
┌──────────┐      ┌────────────────────┐      ┌──────────────┐     ┌──────────────┐
│ HTTP 3条 │      │ ① adm 后台接口  [◉]│─────▶│ LB · adm-lb  │────▶│ 127.0.0.1:9001│
│ :80 :443 │──(+)─│    前缀 /adm        │      │ 2 后端 · 轮询 │  ├─▶│ 127.0.0.1:9101│
└──────────┘  │   └────────────────────┘      └──────────────┘     └──────────────┘
              │   ┌────────────────────┐      ┌──────────────┐
              └──▶│ ② dtw 接口      [◉]│─────▶│ Host · …     │   ← 琥珀
                  └────────────────────┘      └──────────────┘
```

- **行由路由决定**：一个监听器占 `max(路由数, 1)` 行，监听器节点跨这几行垂直居中，
  组与组之间插一个空行。所以**纵向位置就是 `sort_no` 的顺序**——first-match-wins
  这个语义在表格里只是「一列数字」，在图里它是位置。
- **「+」长在监听器出线的那个节点上**，不是卡片里、也不是工具栏里：它是「给这个监听器
  再加一条路由」的最短路径，点开时表单的「所属监听器」已经选好。
- **启停开关在每张卡片的右上角**，不在新建/编辑表单里。启停是「这一块现在参不参与
  渲染」的即时操作，点一下就该生效，不该逼人先开表单再保存。
- **同名的 LB 只画一个节点**，几条路由的连线弯上去汇到它——「哪几条路由共用一个
  负载均衡器」在图上直接看得见，引用数也写在卡片上。
- **目标卡片按类型着色**：LB 绿、Host 琥珀、Static 蓝，连线跟着走。`to.type =
  LoadBalancer` 但库里没有这个 LB 时整卡标红、线也变红——表格只显示 `LB → ghost-lb`，
  看不出 ghost-lb 根本不存在。
- **遮蔽提示**：`shadowedBy(prev, current)` 判断的是「上一条 Prefix 是否真的覆盖这条
  的路径」，不是拿 `前缀 /api` 这种给人看的字符串做前缀比较——那会把 `前缀 /api`
  误判成 `精确 /health` 的遮蔽者。前一条是 `前缀 /` 时覆盖一切。
- **右侧属性栏**：点中任何一张卡片，这里显示它的字段、和谁有关系（点一下能跳过去）、
  以及编辑/删除。名称支持就地改（回车/失焦提交、Esc 撤销）；`matcher_json` 这类结构化
  字段仍然走弹窗——在 268px 宽的栏里编辑 JSON 只会互相折磨。
- **表格视图没删**：十几条路由横着扫比看图快。两种视图共用 `ListenerForm` /
  `RouteForm` / `BalancerForm` 和同一个 `Switch`，不会出现「图里能停用、表里停不了」。

### 一张图要盖住线上 TOML 的每一段

对照 Consul KV 里真实的配置（`dev/gatex-*.toml`），除了链路本身还有四段顶层配置，
它们不挂在任何一条路由上，画进链路里反而误导，所以图底部单列一条**「全局」带**：
`[static]` / `[upstream-error]` / `[ops]` / `[pingora-conf]`（来自 `extra_toml`）/ 其余附加 TOML。
每块可点，属性栏列出全部字段与原始 TOML；带子标题还显示**已发布版本与 checksum**。

链路节点上也补齐了线上有、图里原先没有的字段：

- 路由卡片只标**偏离 gatex 默认值**的行为：`去前缀` / `加前缀` / `路径替换` /
  `改写 Host` / `CORS` / `缓存头` / `上游 TLS` / `独立日志`（默认 `uri=Keep`、
  `preserve-host=true`，全标出来等于没标）
- LB 卡片补 `健康检查` 摘要与 `update-frequency`；Static 卡片补 `static.root-dir`；
  监听器卡片补 TLS 地址数
- 属性栏对每种实体都有一条**「原始 JSON」**（默认收起），一个字段都不藏

⚠️ **界面必须说出「库里写了但线上不生效」的字段**。已经踩到两个：
`upstreamErrorJson` 里的 `content-type`（`UpstreamErrorConfig` 只有
`enabled/status/expose-detail`）、`to.uri` 里的 `parts`（gatex 的 `StripPrefix`
是 unit variant）。serde 会静默丢掉它们，所以全局带显示「N 个键不生效」，
路由卡片显示红色「忽略 parts」，属性栏写明线上实际生效的是什么。

### 连线为什么是量出来的

纯 CSS 只能画「同一行内」的直线，而这里真正要表达的是**汇聚**。所以节点按正常文档流
排（高度自适应内容），渲染后从 DOM 量 `getBoundingClientRect`，再用 SVG 三次贝塞尔
从「卡片右边缘中点」画到「目标卡片左边缘中点」。测量在三种时机重跑：数据变化、
容器尺寸变化（`ResizeObserver`）、字体加载完成（`document.fonts.ready`，否则中文
回退字体替换会让第一帧坐标偏掉）。

列宽由 `.cfg` 上的 `--gg-c1…c4` 一套变量控制，**表头和网格引用同一套**，改一处两边
都跟着动；窗口窄到放不下「属性栏 + 四列」时用**容器查询**（不是媒体查询——窗口可以在
大屏里拖窄，媒体查询只看浏览器视口）把属性栏折到图下面，图自己横向滚动。

### 启停为什么不在表单里

`uiam` 的更新接口是 **PUT 全量**，漏一个字段就等于把它清空。「在图上点一下启用」
最容易犯这个错——只想着 `enabled`，忘了 `addrs_json`。所以所有「改一个字段」的地方
都先 `as*Payload(entity)` 铺底（`src/lib/payload.ts`）再覆盖目标字段。

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
│   ├── Desktop.tsx      壁纸 + 组件网格 + 窗口层 + 编辑态交互
│   ├── MenuBar.tsx      站点图标/标题 + 编辑桌面 + 主题 + 时钟
│   ├── Dock.tsx / Launchpad.tsx / Window.tsx
│   ├── widgets.tsx      8 个桌面组件（骨架占位、更新时间、尺寸增量）
│   ├── WidgetGallery.tsx 小组件中心
│   ├── widgetAppearance.ts 外观状态机与全局令牌
│   ├── useWidgetGeometry.ts 壁纸对齐坐标测量
│   ├── useWidgetLayout.ts 尺寸族、布局与旧数据迁移
│   └── overview.tsx     组件共用的聚合数据
├── lib/             api / types / format / diff / theme / payload
│                    + site.ts（站点身份）/ preferences.ts（可插拔偏好存储）
├── state/           GatewayList（实例列表）、useGatewayTree（一棵子树）
├── components/      弹窗、抽屉、Toast、JSON 编辑器、代码视图、diff
│                    + ListenerForm / RouteForm / BalancerForm / Switch（图与表格共用）
└── pages/
    ├── graph/       配置图
    │   ├── model.ts       三张表 → 节点/连线/行号（含汇聚去重、遮蔽判定）
    │   ├── global.ts      全局段（static / upstream-error / ops / pingora / extra_toml）
    │   ├── GatewayGraph.tsx 四列网格 + 测量后 SVG 贝塞尔连线 + 出线上的「+」
    │   ├── GlobalBand.tsx  图底全局带 + 已发布版本
    │   └── Inspector.tsx  右侧属性栏（五种选中态 + 就地改名 + 原始 JSON）
    └── tabs/
        ├── ConfigTab.tsx  编排：图形/表格切换、启停、表单、删除确认
        └── ListenersTab / RoutesTab / BalancersTab / ReleasesTab / OverviewTab
```

## 主题

只有 `light` / `dark` 两态，**没有「跟随系统」**。系统偏好只在 localStorage 没有记录时
决定初值，之后系统怎么变都不影响——否则用户手动选过的主题会在某天夜里被覆盖。

切换用 `document.startViewTransition` + `clip-path: circle(0 → r at 图标中心)`：
圆心取菜单栏外观图标的 `getBoundingClientRect()` 中点，不是鼠标点、也不是屏幕中心。
不支持或用户要求减少动效时退回整页 CSS 过渡。

## 桌面组件外观与玻璃

`src/shell/widgetAppearance.ts` 把 macOS 27 的三组设置映射成全局令牌：

| 设置 | 令牌 | 行为 |
|---|---|---|
| 图标与小组件样式 | `data-wg-style` = default / clear / tinted | clear/tinted 下内容按 primary、accent 两组统一染白，彩色底纹关掉 |
| Liquid Glass 滑块 | `--wg-glass` 0…1 | **一个值全局统一**：组件、菜单栏、Dock、窗口标题栏共读；左 Clear 最透、右 Tinted 最实。设置页显示的是**不透明度** `(1 - glass)`，与滑块位置同向 |
| 调暗桌面小组件 | `data-wg-dim` = auto / always / never | auto 由 `data-has-windows` 决定，有窗口盖住桌面时转单色 |

⚠️ **全站仍然不用 `backdrop-filter`**（`0f99d7f` 实测：任意一帧重绘都会让四十多处
毛玻璃一起重算，60fps → 9fps）。玻璃改成四层静态合成：

1. `.widget` 自身铺 `--wall-gradient`（和 `.desktop` 同一份静态渐变），
   `background-size: 100vw 100vh` + `--wg-x/--wg-y` 负向偏移 → 显示组件背后那块壁纸；
2. `::before` 是可调雾化层 + 色晕，`opacity` 由通透度决定；
3. `::after` 用 `mask-composite: exclude` 做 1px 环形镜面高光，模拟玻璃厚度；
4. 内容层全部走语义变量，clear / tinted / 单色模式只换变量，不用 `filter` 造合成层。

⚠️ 语义别名 `--wg-t1/--wg-t2` **必须在 `.widget` 上重新声明一次**。自定义属性的
`var()` 是在「声明所在元素」求值的：只写在 `:root` 的话会提前固化成深色，等 clear /
tinted 在 `.widget` 上覆盖 `--wg-ink` 时，继承下来的别名不会跟着变，次要文字会在深色
玻璃上变成深色而读不出来。

`--wg-x/--wg-y` 由 `useWidgetGeometry.ts` 在布局变化、resize、滚动、字体就绪时量一次
（复用配置图那套 `ResizeObserver` + `document.fonts.ready` 手法），用 `offsetLeft/offsetTop`
而不是 `getBoundingClientRect()`——组件有入场与 hover 的 transform，量矩形会带位移。

`prefers-reduced-transparency` / `prefers-contrast: more` 命中时强制回落到不透明实底，
也就是改造前那套；`prefers-reduced-motion` 关掉入场与编辑态抖动。

## 站点身份与偏好存储

- **站点图标 / 标题**：构建期 `VITE_SITE_NAME`、`VITE_SITE_ICON`（预设
  `gateway` / `grid` / `pulse` / `layers` 或图片 URL），运行时在「系统设置 → 站点」里改；
  两个来源都同步 `document.title` 与 favicon。标题默认「统一身份认证平台」，见 `src/lib/site.ts`。
- **统一登录**：生产构建（`VITE_AUTH_MODE=required`）未登录只显示仿 macOS 锁屏，
  账号密码由 adm-svr 校验（浏览器内先做 SM3），与其余六端共用 `adm.auth.session`；
  登录成功的账户记在 `uiam.login.accounts`，下次锁屏以头像列表直接选， hover 可移除。
  只记账号与展示名，不存密码或令牌。开发构建 `VITE_AUTH_MODE=disabled` 直接进桌面。
- **偏好存储**：`src/lib/preferences.ts` 是可插拔读写口，默认 `localStorage`
  （`uiam-desktop` / `uiam-widget-appearance` / `uiam-site` / `uiam-gallery`）。
  ⚠️ `uiam-svr` 目前**没有偏好设置接口**，所以配了 `VITE_PREFERENCES_URL` 才会启用
  远端：启动 GET 一份 JSON 快照、改动防抖 PUT（带 `X-User-Id`），连不上静默回退本地。
  不配也不会假装跨设备同步。
- **旧布局迁移**：`uiam-desktop` 的 v1 数组（`{id,w,h}`）自动映射到尺寸族，
  用户摆好的桌面不会因升级被清空。

## 一期已知取舍

- **登录只做口令这一种**：锁屏支持记住过的账户选择，暂不做扫码 / SSO 三方登录；
  权限菜单仍由 adm 那端负责
- **只有网关这一条链路是真接后端的**：用户/角色/应用/会话/审计还没实现，
  所以桌面上不出现这些应用，不做点开是空壳的假图标
- **列表接口带 `content`**：发布历史每行都拖着整份 TOML，一期接受
- **diff 是行级的**：`src/lib/diff.ts` 用 LCS 现算，不做词级最小化
- **偏好默认只存本机**：`VITE_PREFERENCES_URL` 未配置时换设备不跟随；后端偏好接口
  落地后填一个 URL 即可切换，前端不需要再改代码
- **「深色」图标与小组件样式未单独暴露**：Apple 在「图标与小组件样式」里还有第四档
  「深色」，这里把它与已有的全局 `data-theme='dark'` 合并了——再拆一档会出现
  「系统浅色 + 组件深色」和「系统深色 + 组件默认」两套语义重叠的状态
