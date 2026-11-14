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

React 19 + Vite 8 + React Router 7 + Tailwind 4，无 UI 组件库。

```bash
cd uiam-web
npm install
npm run dev      # http://127.0.0.1:5180，/uiam 反代到 127.0.0.1:9002
npm run build    # 产物在 dist/
```

- `prototype/` 是设计原型（四方案对比，A = macOS Liquid Glass 已选），与工程代码无关
- 主题只有 `light` / `dark` 两态，点图标直接切，扩散圆心是图标中心（见 `src/lib/theme.ts`）
- 一期没有登录，写接口靠侧边栏底部的「操作者 ID」填 `X-User-Id`，审计落在 `release.creater_id`
- 详细说明见 `uiam-web/README.md`
