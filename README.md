# uiam

统一身份认证平台（**U**nified **I**dentity & **A**ccess **M**anagement），原 `gatex-admin` 改名而来。

一句话：**网关管理面 + 统一身份认证**，最终目标是操作系统式的 web 应用平台。

## 分期

| 步 | 内容 | 状态 |
|---|---|---|
| 0 | 工程骨架：`uiam-api` / `uiam-api-client` / `uiam-svr` + migrations | 进行中 |
| 1 | 网关管理面：5 表 CRUD + 发布流水线 + 版本回滚 | 未开始 |
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

Swagger 在 `/swagger-ui`，健康检查在 `/ops/health`。
