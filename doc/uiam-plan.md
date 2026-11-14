# uiam 建设规划

> **一句话**：uiam = 网关管理面 + 统一身份认证，分四步走，每步都能独立交付、独立验收。
> 本文只解决「边界」和「顺序」，不写实现细节。数据模型见 `uiam-data-model.md`（仅一期部分有效）。

---

## 1. 边界

### 1.1 uiam 管什么

| 能力 | 一期 | 二期 | 三期 |
|---|:--:|:--:|:--:|
| 网关配置的结构化编辑（listener / route / balancer / ops / static） | ✅ | | |
| 配置发布到 Consul KV（渲染 TOML → 校验 → 推送 → 回填） | ✅ | | |
| 发布版本历史与回滚 | ✅ | | |
| 操作审计（谁在什么时候改了什么、发布了哪一版） | ✅ | | |
| 应用接入登记（client_id / redirect_uri / home_url） | | ✅ | |
| SSO 会话与 token 签发（OIDC / 内部 JWT） | | ✅ | |
| 身份与权限的**只读副本**（供 token 内联权限、本地验签） | | ✅ | |
| 工作台（我的应用 + 我的菜单） | | | ✅ |

### 1.2 uiam 不管什么

这一栏比上面更重要——**边界不清，两个服务就会互相长出对方的字段**。

| 能力 | 归属 | 理由 |
|---|---|---|
| 账号增删改查 | **adm** | 账号是 adm 的核心域，uiam 没有理由再开一个写入口 |
| 密码 / 登录 / 失败锁定 / 登录日志 | **adm** | uiam 不持有密码就不该做登录；`adm_lock_log`、`adm_login_log` 已有完整实现 |
| 角色 / 权限 / 应用 / 菜单的**定义** | **adm** | uiam 只消费，不生产 |
| 组织架构 / 数据域 / 人员档案 | **adm** | 认证链路用不到 |
| 业务数据 | 各业务服务 | — |
| 旧网关（gatex01…09，Vert.x）的配置渲染 | **不做** | 本期不纳管，见 §5 |

### 1.3 依赖方向

```
uiam-svr ──读/写 Consul KV──▶ gatex-svr        （配置契约：共享 gatex-svr 的 AppConfig 类型）
uiam-svr ──dbz CDC 单向───▶ adm 库            （只读副本，二期）
uiam-svr ──feign─────────▶ adm-svr            （仅管理操作，不进认证热路径）
uiam-web ──HTTP──────────▶ uiam-svr
```

三条铁律：

1. **gatex-svr 永远不反向调 uiam**。网关侧只认 Consul KV，这是 gatex 一直以来的铁律，不能破。
2. **adm 不依赖 uiam**。uiam 挂了，adm 自己的功能必须照常可用。
3. **uiam 不持有密码**。这条直接决定二期数据模型里没有 `login_pswd` 这类字段。

---

## 2. 四步走

### 第 0 步 · 工程骨架

| 项 | 内容 |
|---|---|
| 目标 | 一个能 `cargo run` 起来、能连库、能出 openapi 的空壳 |
| 交付 | `uiam-api` / `uiam-api-client` / `uiam-svr` 三个 crate + `uiam-web` 前端骨架；一个 demo 实体跑通增删改查 |
| 验收 | `cargo check --workspace` 过；`/actuator/health` 返回 200；swagger 页面能打开并调通 demo 接口 |
| 不做 | 业务逻辑 |

这一步的唯一价值是**把 robotech 模板跑通**，后面所有东西都是往里填。照 `jobx` 的目录结构抄即可。

**完成情况（2026-11-14）**：

- 三个 crate + workspace 落地，`cargo check --workspace` 零警告
- 5 张表的 `migrations/pgsql` 一次建好（建表 / 索引 / 初始数据），`mysql`、`sqlite` 先放 `.gitkeep`
- 5 张表的 `mo`（entity）全部写好；DTO / VO / dao / svc / ctrl / router / api_doc 只做了 `uiam_gateway`
- 本机跑通：`db_migrate!` 三个脚本顺序执行成功，`/actuator/health` → `Ok`，
  `POST /uiam/gateway` 建记录、`GET /uiam/gateway/list`、`/page`、`/search/page` 均正常，
  `#[dao(unique_keys)]` 的重复校验返回「实例标识<svr02>已存在！」，
  `DELETE /uiam/gateway/{id}` 正常

**比计划多做的一点**：5 张表的 migrations 和 entity 一次建完了。字段已经定稿，分两次建表只会多一次迁移；
业务层仍然只做 gateway，其余 4 张表留到第 1 步。

**踩到的两个点**（写进 README 省得下次再试）：

- `#[router(crud)]` 里 **add 的路径就是 crud_path 本身**（`POST /uiam/gateway`），不是 `/add`；
  `/add` 会落到 `/{id}` 路由上，返回 405 且 `allow: DELETE, GET, HEAD`
- 写接口必须带 `X-User-Id` 头（`USER_ID_HEADER_NAME`），否则校验失败；`X-Current-Ms` 可选


### 第 1 步 · 网关管理面（主体）

| 项 | 内容 |
|---|---|
| 目标 | 替代「手工改 Consul KV + 重启网关」 |
| 交付 | 5 张表 + 三方言迁移；配置 CRUD；发布流水线；版本历史与回滚；审计 |
| 验收 | 在 uiam 界面上改一条路由 → 点发布 → 网关生效，全程不碰命令行、不重启网关 |
| 不做 | 认证相关的任何东西 |

**为什么先做这个**：需求最明确、不依赖任何待定问题、能立刻产生价值（gatex 现在改配置还得手工改 KV）。而且做完之后 uiam 就是一个能跑能部署的完整服务，二期加认证是增量，不是推倒重来。

### 第 2 步 · 统一身份认证

| 项 | 内容 |
|---|---|
| 目标 | 各业务系统接入单点登录 |
| 前置 | 需要先定 §5 的 3 件事 |
| 交付 | 待定（定完再写） |
| 不做 | 工作台 |

### 第 3 步 · 工作台 / 应用平台

| 项 | 内容 |
|---|---|
| 目标 | 登录后看到「我的应用 + 我的菜单」 |
| 前置 | 第 2 步完成 |
| 交付 | 待定 |
| 不做 | — |

---

## 3. 一期数据模型（5 张表）

只有一期是定死的。二期、三期的表等做到那一步再设计，现在写出来大概率要改。

### 3.1 设计原则

**复杂结构用 JSON 列，不拆成几十个字段。**

gatex 的 `RouteMatcherConfig` 有 5 种变体、`ToConfig` 有 N 种变体，字段差异很大。硬拆成列的结果是一张表几十列、一半永远为空。JSON 列 + 前端表单生成，渲染时 `serde_json::from_str` 再序列化成 TOML，类型安全由 Rust 保证。

只把**需要索引、排序、引用校验**的部分拆成列。

### 3.2 表清单

```sql
-- ① 网关实例：对应 Consul KV 里的一个 key
uiam_gateway
  id, code(UK), name, consul_key, remark, enabled,
  extra_toml      -- pingora-conf 等无法结构化的部分，TOML 文本
  ops_json        -- OpsConfig：health_path / metrics_path / addrs
  static_json     -- StaticConfig：root_dir / page_404_path
  upstream_error_json
  审计字段

-- ② 发布版本：每次发布一行，content 是渲染出的完整 TOML
uiam_gateway_release
  id, gateway_id, version, content, checksum, pushed, pushed_ms, creater_id, create_ms
  UK(gateway_id, version)

-- ③ 监听器：http 与 tcp 同构（addrs + routes），用 kind 区分
uiam_gateway_listener
  id, gateway_id, kind, sort_no, addrs_json, remark, enabled, 审计字段

-- ④ 路由：matcher / to / log 三块各自一个 JSON 列
uiam_gateway_route
  id, listener_id, sort_no, name, matcher_json, to_json, log_json, enabled, 审计字段

-- ⑤ 负载均衡器：name 是 route 里 `to.type = "load-balancer"` 引用的名字
uiam_gateway_balancer
  id, gateway_id, name, config_json, remark, enabled, 审计字段
  UK(gateway_id, name)
```

对照 `AppConfig` 的七个顶层字段：`pingora_conf` → `extra_toml`；`listeners` / `tcp_listeners` → 表 ③④；`balancers` → 表 ⑤；`ops` / `static` / `upstream_error` → 表 ① 的 JSON 列。**一个不漏**。

### 3.3 为什么不设这几张表

| 曾考虑的表 | 不做的理由 |
|---|---|
| `uiam_gateway_cert` | 证书在 `ListenerAddrConfig.tls` 里，是 listener 的一部分，不是独立实体 |
| `uiam_gateway_ops` / `_static` | 各 2~3 个字段，独立成表是负资产 |
| `uiam_gateway_node`（节点状态） | 节点在线状态是运行时数据，从 Consul 服务目录读，不落库 |

---

## 4. 一期关键技术决策

| # | 决策 | 理由 |
|---|---|---|
| 1 | 发布时**渲染完整 TOML**，不做增量 | `listeners` 在 gatex 是整段替换语义，增量合并必然出错 |
| 2 | `extra_toml` 用 `toml::Value` **合并**，不字符串拼接 | 拼接会把语法错误留到网关启动时才炸 |
| 3 | 发布前跑 `validate_app_config()` | gatex 2.0.8 已实现，走的是网关启动同一个 `build`，所以「管理面说能发布」= 「网关能装起来」 |
| 4 | 发布前跑 `structural_change()` 比对上一版 | 结构性变更（listener 增减）需要重启，必须提前告知用户，不能静默推送 |
| 5 | 先写库（`pushed=false`）→ PUT KV → 回填 `pushed=true` | 推送失败时库里留着记录，能看出「渲染成功了但没推上去」 |
| 6 | 证书只存路径，私钥不进库、不进快照 | 库和发布记录都会被备份、被审计 |

---

## 5. 二期开工前要定的 3 件事

现在不定，等一期做完再定。写在这里只是防止遗漏。

1. **登录归属**：用户名口令由 adm 校验（uiam 只换 token），还是 uiam 托管登录页转发给 adm。这决定 uiam 是否持有密码副本。
2. **覆盖能力**：单点登录 / 单点登出、token 签发与本地验签、应用接入登记、在线会话管理——具体要哪几项。
3. **副本范围**：token 里要内联哪些权限、工作台要渲染哪些菜单，决定了要从 adm 同步哪几张表。

---

## 6. 现在要做的

只有一件：**第 0 步，把骨架立起来**。

骨架跑通之后立刻进第 1 步，中间不需要再做设计评审。
