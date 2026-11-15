# uiam

统一身份认证平台（**U**nified **I**dentity & **A**ccess **M**anagement），原 `gatex-admin` 改名而来。

一句话：**网关管理面 + 统一身份认证**，最终目标是操作系统式的 web 应用平台。

## 分期

| 步 | 内容 | 状态 |
|---|---|---|
| 0 | 工程骨架：`uiam-api` / `uiam-api-client` / `uiam-svr` + migrations | 已完成 |
| 1 | 网关管理面：5 表 CRUD + 发布流水线 + 版本回滚 + 管理界面 | 已完成 |
| 2 | 统一身份认证（SSO） | 未开始 |
| 3 | 工作台 / 应用平台 | 未开始 |

先做网关管理面，是因为需求最明确、不依赖任何待定问题，而且立刻能替代「手工改 Consul KV + 重启网关」。

## 边界

- **不持有密码、不做登录、不做失败锁定**——账号/密码/登录/角色/权限/应用/菜单的**定义**全归 `adm-rs`，uiam 只读消费
- **不定义**角色/权限/应用/菜单
- **网关侧永不反向调 uiam**（gatex 铁律）
- `adm` 不依赖 uiam

## 目录

```
uiam/
├── uiam-api/         共享 DTO / VO / MO / 字典
├── uiam-api-client/  feign 客户端
├── uiam-svr/         服务端（配置 / dao / svc / web / migrations）
├── uiam-web/         前端（原型在 prototype/）
└── doc/
    ├── uiam-plan.md         边界与分期
    └── uiam-data-model.md   一期 5 表与发布流水线
```

## 一期 5 张表

| 表 | 对应 `AppConfig` |
|---|---|
| `uiam_gateway` | `pingora-conf` / `ops` / `static` / `upstream-error` |
| `uiam_gateway_listener` | `listeners` + `tcp-listeners`（`kind` 1=http 2=tcp） |
| `uiam_gateway_route` | `listeners[].routes` |
| `uiam_gateway_balancer` | `balancers` |
| `uiam_gateway_release` | 发布产物，`content` 存渲染出的完整 TOML |

## 运行

```bash
# 需要 PostgreSQL 与 Consul；配置见 uiam-svr/uiam-svr.toml
cargo run -p uiam-svr
```

Swagger 在 `/swagger-ui/`，健康检查在 `/actuator/health`。

## 前端（`uiam-web/`）

React 19 + Vite 8 + Tailwind 4，无 UI 组件库、无路由库。

```bash
cd uiam-web
npm install
npm run dev      # http://127.0.0.1:5180，/uiam 反代到 127.0.0.1:9002
npm run build    # 产物在 dist/
```

- `prototype/` 是设计原型（四方案对比，**A = macOS 26 Tahoe / Liquid Glass 已定稿**）；
  工程代码按 A 实现：壁纸 + 菜单栏 + 组件网格 + Dock + 启动台 +
  **可拖拽、八向改大小的窗口**
- 业务内容住在窗口里（网关配置 / 接口速查 / 系统设置 / 关于），不是侧边栏后台
- 网关实例列在窗口**顶部一排 chip**，不在左侧；窗口拉窄时用**容器查询**（不是媒体查询）
  把属性栏折到图下方
- **整个网关配置就是一张图**：四列 `监听器 → 路由 → 目标 → 后端`，纵向位置即 `sort_no`
  （first-match-wins 在表格里只是一列数字，在图里是能看懂的先后），右上角可切回表格，
  右侧属性栏看完整字段。不属于任何一条链路的顶层段（`static` / `upstream-error` /
  `ops` / `pingora-conf` / 附加 TOML）集中在图底的「全局」带里，并显示线上版本与 checksum
- 卡片右上角直接启停，新建/编辑表单里没有启用项；只标**偏离 gatex 默认值**的行为，
  无效字段（`[upstream-error].content-type`、`StripPrefix.parts` 等 serde 会静默忽略的键）
  在图和属性栏里显式标红
- 主题只有 `light` / `dark` 两态，点菜单栏图标直接切，扩散圆心是图标中心（见 `src/lib/theme.ts`）
- 一期没有登录，写接口靠「系统设置」里的操作者 ID 填 `X-User-Id`，审计落在 `release.creater_id`
- 生产形态：`npm run build` 的 `dist/` 由 gatex 的 `[static].root-dir` 托管，接口前缀
  `/uiam-svr`（网关按服务名分流并 `StripPrefix`，uiam-svr 收到的仍是 `/uiam/...`）——
  值写在 `uiam-web/.env.production` 的 `VITE_API_BASE`，两边同源不需要 CORS；dev 侧
  由 `vite.config.ts` 的 `/uiam` proxy 对齐（`VITE_API_BASE` 留空）
- 详细说明见 `uiam-web/README.md`
