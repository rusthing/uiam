> ⚠️ **本文档已作废，仅作历史参考（2026-11-14 20:30 归档）。**
> 它建立在「uiam 自己校验密码、自己做登录」这个**错误假设**上，认证部分（身份副本的密码字段、`uiam_login_attempt` 锁定、认证流水线）全部无效。
> 现行文档：`uiam-plan.md`（边界与分期）+ `uiam-data-model.md`（一期 5 张表）。
> 仍然有效的部分：§1.2 生产基础设施核实结果、§2 方案对比（A/B/C 选 C）、§8 网关配置的分析思路。

# uiam 数据模型（第 2 步交付）

> 状态：**草案 v2（含 dbz 同步方案）**　日期：2026-11-14
> 上游约束：`gatex/doc/gatex-db-config-plan.md`（网关配置管理面）
> 定位：**统一身份认证平台（Unified Identity & Access Management）**，与 `gatex-rs` 并立，标准 `robotech-rs` 微服务。

---

## 1. 定位与边界

| 能力 | 归属 | 说明 |
|---|---|---|
| 账号、人员、组织、角色、权限、应用、菜单 | **adm-rs（写入侧真源）** | uiam **不写**这些数据，只通过 dbz 同步出一份**只读副本** |
| 登录口令校验 | **uiam** | 读本地副本比对 SM3 摘要，**认证路径不调 adm** |
| 锁定与失败计数 | **uiam** | 认证在 uiam 做，锁定就必须在 uiam 做（见 §5.5 与 §12 待确认 1） |
| 标准 OIDC / OAuth2 Provider | **uiam** | authorization code + PKCE、refresh token、id token、JWKS、单点登出 |
| 内部 JWT 签发 | **uiam** | ES512，与旧网关同源 keystore，旧网关能直接验签 |
| 工作台 | **uiam** | 应用清单来自同步副本，只做视图 + 收藏 + 布局 |
| 网关配置管理（gatex-rs） | **uiam** | 结构化编辑 → 试装配 → 发布到 Consul KV → 版本与回滚 |
| 旧网关（gatex01…09） | **不进 uiam** | 本期不纳管，但 token 要能被它验 |
| 多因子 / 多租户 | **不做** | 见 §12 |

### 1.1 数据流：dbz CDC → uiam 落表 → 本地缓存

```
  adm 库 ──CDC──▶ Kafka topic `adm.adm.*` ──HttpSinkConnector──▶ uiam 内部接口
                    （adm-source 已在跑）                          │
                                                                  ├─▶ upsert 副本表（F 域）
                                                                  └─▶ publish 刷新信号（NATS）
                                                                          │
  认证请求 ──▶ 内存快照（ArcSwap）──校验 SM3──▶ session + token      └─▶ 各副本全量重建
                （零 DB、零 RPC）
```

三层各司其职：

| 层 | 载体 | 作用 | 挂了会怎样 |
|---|---|---|---|
| **同步** | Kafka + Kafka Connect（dbz 管理） | 把 adm 的变更搬过来 | 副本变旧，但已登录的人照常使用 |
| **落表** | uiam 自己的库（F 域） | 持久、可查、重启不丢、可审计 | 认证回退到「表为空则拒绝登录」 |
| **缓存** | `robotech::cache::setup_local_cache`（`ArcSwapOption`） | 热路径零查询 | 自动回查表（仍不调 adm） |

**为什么不能只有缓存**：robotech 的本地缓存是「全量快照 + 刷新信号」，进程重启后要先重建；如果数据源是 adm 的接口，那启动期就依赖 adm 可用，且每次重建都是一次全量 RPC。**落表之后，重建只是读自己的库。**

**为什么不能只有落表**：每次登录查 4 张表 + 拼权限，热路径上是 4 次 IO；用 `setup_local_cache` 把它变成一次 `ArcSwap::load()`，与 `alarm` / `msg` 的既有做法一致。

### 1.2 基础设施现状（已核实，2026-11-14）

生产已具备，**不需要新增组件**：

| 组件 | 状态 | 用途 |
|---|---|---|
| `dbz_svr` | 3/3 | 同步任务管理面 |
| `kafka_broker-1/2/3` + `kafka_connect_connect` | 均 1/1 | CDC 管道 |
| `adm-source` connector | 已存在 | adm 库的变更已在 Kafka 里 |
| `adm-to-dtwrs-dtw-person-sink` 等 | 已存在 | 既有「adm → dtw-rs」的 HttpSink 模式，uiam 照抄 |
| `nats_svr` | 1/1 | `local-cache` 的刷新信号通道 |
| `redis_svr` | 1/1 | 本期不用 |

---

## 2. 方案对比：认证数据从哪来

| 方案 | 做法 | 认证是否调 adm | 重启后 | 实时性 | 改动面 | 结论 |
|---|---|---|---|---|---|---|
| **A. 只用 robotech 缓存** | `setup_local_cache` 的 rebuild 回调直接调 adm 接口全量拉 | ❌ 登录不调，但**每次重建都调** | 依赖 adm 可用 | 取决于刷新信号 | adm 要新增「全量认证快照」接口 + 在写路径发刷新信号 | 不选：adm 一行不改就做不到 |
| **B. 只用 dbz 落表** | CDC → uiam 落表，认证查表 | ❌ | ✅ 自洽 | 秒级（Kafka 延迟） | 只加一个 sink + uiam 接收接口，**adm 零改动** | 可行，但热路径 4 次 IO |
| **C. dbz 落表 + robotech 缓存（推荐）** | B 落表，再用 `setup_local_cache` 把表刷进内存；同步接口写完表就发刷新信号 | ❌ | ✅ 自愈（缓存空则回查表） | 秒级 | B + uiam 侧缓存装配（与 `alarm` 同构） | **选它**：符合框架惯例，热路径零 IO |

**为什么不选 A**：`setup_local_cache` 的语义是「收到信号 → 全量重建」，重建函数是**数据源**。数据源放 adm 的 HTTP 接口，等于把 adm 的可用性绑进 uiam 的启动与刷新路径 —— 而这正是我们要摆脱的东西。数据源放自己的库，才谈得上「不调 adm」。

**B 与 C 的分界**：B 是「数据正确」，C 是「数据正确 + 热路径快」。C 多出来的成本只是 `{对象}_cache.rs` + `cache_utils.rs` 两个文件，与 `alarm-svr/src/cache/` 完全同构。

---

## 3. 域划分与表清单

| 域 | 表 | 数量 |
|---|---|---|
| **A. 认证核心** | `uiam_client`、`uiam_signing_key`、`uiam_session`、`uiam_auth_code`、`uiam_token`、`uiam_consent` | 6 |
| **B. 平台配置** | `uiam_option`、`uiam_upstream_auth` | 2 |
| **C. 工作台** | `uiam_app_favorite`、`uiam_workbench_layout` | 2 |
| **D. 网关配置** | `uiam_gateway`、`uiam_gateway_listener`、`uiam_gateway_route`、`uiam_gateway_balancer`、`uiam_gateway_static`、`uiam_gateway_cert`、`uiam_gateway_ops`、`uiam_gateway_release` | 8 |
| **E. 审计** | `uiam_audit_log` | 1 |
| **F. 身份副本（dbz 同步，只读）** | `uiam_user_auth`、`uiam_user_role`、`uiam_role_perm`、`uiam_role_app`、`uiam_login_attempt` | 5 |

**共 24 张表。** 统一审计字段 `id`(i64)/`creater_id`/`create_ms`/`updater_id`/`update_ms`；表名 `uiam_` 前缀；业务唯一键叫 `code`；时间统一 `*_ms`（i64 毫秒）。

---

## 4. F 域：身份副本（dbz 同步）

> **整个 F 域都是只读副本**：唯一写入方是 `POST /uiam/internal/sync/*`（dbz 的 HttpSink 调它）。业务代码只读。
> 每个同步接口写完表后立刻 `publish_cache_refresh_signal`，热路径靠内存快照。

### 4.1 `uiam_user_auth` — 用户认证副本

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | **= `adm_user.id`**，不自增（同步来的主键必须与真源一致） |
| username | varchar(64) UK | 登录名 |
| real_name | varchar(64) NULL | |
| login_pswd | varchar(128) | SM3 摘要，与 adm 一致 |
| login_pswd_salt | varchar(64) | |
| login_pswd_default | bool | 是否初始口令（登录后强制改） |
| audit_pswd / audit_pswd_salt | varchar(128) / varchar(64) NULL | 审核口令 |
| status | i16 | 与 adm 同语义 |
| sync_ms | i64 | 本条最后一次同步时间 |
| sync_op | varchar(8) | `c` / `u` / `d`（CDC 的 op，排查用） |
| 审计 5 字段 | | 由同步接口填充（`creater_id=0` 表示系统） |

**为什么不存手机号/邮箱/证件**：认证只需要「账号 + 摘要 + 状态」。多余字段等于把 adm 的用户表复制一遍，将来改字段要同步改两处。

### 4.2 `uiam_user_role` — 用户角色副本

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | 自增 |
| user_id | i64 | |
| role_id | i64 | |
| role_code | varchar(64) | 冗余，避免再查角色表 |
| role_name | varchar(128) | 冗余，工作台展示用 |
| sync_ms | i64 | |
| 审计 5 字段 | | |

唯一键 `(user_id, role_id)`。

### 4.3 `uiam_role_perm` — 角色权限副本

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | 自增 |
| role_id | i64 | |
| perm_code | varchar(128) | 权限点编码（如 `gatex:gateway:publish`） |
| sync_ms | i64 | |
| 审计 5 字段 | | |

唯一键 `(role_id, perm_code)`。**只同步编码，不同步权限点名称**——鉴权只认编码。

### 4.4 `uiam_role_app` — 角色可见应用副本

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | 自增 |
| role_id | i64 | |
| app_id | i64 | `adm_app.id` |
| app_code | varchar(64) | 冗余 |
| app_name | varchar(128) | 冗余，工作台磁贴标题 |
| app_icon | varchar(255) NULL | 冗余 |
| app_url | varchar(512) | 冗余，磁贴跳转地址 |
| sort_no | int | 磁贴排序 |
| sync_ms | i64 | |
| 审计 5 字段 | | |

唯一键 `(role_id, app_id)`。

**为什么把应用元数据冗余进来**：工作台是登录后第一屏，不该为了一屏磁贴再查 3 张表。冗余字段的唯一来源是 dbz 同步，不存在两边都能改的问题。

### 4.5 `uiam_login_attempt` — 登录失败计数

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | |
| username | varchar(64) | |
| ip | varchar(64) | |
| fail_count | int | 连续失败次数 |
| first_fail_ms / last_fail_ms | i64 | 窗口起点/最近一次 |
| locked_until_ms | i64 NULL | 锁定到期；空表示未锁 |
| 审计 5 字段 | | |

唯一键 `(username, ip)`。

**为什么这张表是 uiam 自己的、不是副本**：认证搬到 uiam 之后，adm 的 `adm_lock_log` 收不到失败事件。锁定必须由实际做校验的一方维护，否则「校验在 uiam、锁定在 adm」= 锁定永远不触发。

---

## 5. A 域：认证核心

### 5.1 `uiam_client` — OIDC 接入方

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | |
| code | varchar(64) UK | `adm-web` / `uiam-web` / `gatex-rs` |
| name | varchar(128) | |
| app_id | i64 NULL | 关联 `adm_app.id`（跨服务引用，无外键） |
| client_id | varchar(64) UK | |
| client_secret_hash | varchar(128) NULL | 机密客户端才有，明文只在创建时返回一次 |
| client_type | varchar(16) | `public` / `confidential` |
| grant_types | json | |
| redirect_uris | json | 精确匹配，不支持通配 |
| post_logout_redirect_uris | json | |
| scopes | json | `openid` / `profile` / `roles` / `perms` |
| pkce_required | bool | 默认 `true`；`public` 强制 |
| access_token_ttl | int | 秒，默认 1800（与旧网关 `expires` 对齐） |
| refresh_token_ttl | int | 秒，默认 604800 |
| id_token_ttl | int | 秒，默认 1800 |
| enabled | bool | |
| remark | varchar(255) | |
| 审计 5 字段 | | |

### 5.2 `uiam_signing_key` — 签名密钥

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | |
| kid | varchar(64) UK | JWKS 的 `kid` |
| alg | varchar(16) | `ES512`（默认，兼容旧网关）/ `RS256` |
| public_key | text | PEM，暴露到 `/oidc/jwks` |
| keystore_path / keystore_alias | varchar(255) / varchar(64) NULL | 迁移期指旧网关的 `keystore.pfx` |
| secret_cipher | text NULL | 私钥或口令密文 |
| active | bool | 同一时刻只允许一个 `true` |
| not_before_ms / not_after_ms | i64 | 轮换窗口 |
| 审计 5 字段 | | |

**这张表是「旧网关能验 uiam 的 token」的落点**：旧网关用 `config.yml` 的 `keystore.pfx` + `ES512` + `issuer: zbz` 验签，uiam 的 active key 必须是**同一把 EC 密钥**；轮换要先把新 key 发到旧网关 keystore，再切 `active`。

### 5.3 `uiam_session` — 登录会话

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | |
| session_id | varchar(64) UK | 随机串，写进 SSO cookie（`HttpOnly` + `SameSite=Lax`） |
| user_id | i64 | `adm_user.id` |
| username | varchar(64) | 冗余快照（adm 改名不影响已建会话的展示） |
| auth_method | varchar(32) | `pwd` |
| auth_time_ms | i64 | OIDC `auth_time` |
| last_seen_ms | i64 | 每次带 session 访问刷新 |
| expires_ms | i64 | 绝对过期，不随访问延长 |
| ip / user_agent | varchar(64) / varchar(255) | |
| status | varchar(16) | `active` / `logged_out` / `expired` |
| logout_reason | varchar(64) NULL | `user` / `admin` / `password-changed` / `session-limit` |
| 审计 5 字段 | | |

索引 `(user_id, status)`、`(expires_ms)`。

### 5.4 `uiam_auth_code` — 授权码

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | |
| code_hash | varchar(128) UK | 只存摘要 |
| client_id / user_id / session_id | varchar(64) / i64 / varchar(64) | |
| redirect_uri | varchar(512) | 换 token 时必须一致 |
| scope | varchar(512) | |
| nonce | varchar(128) NULL | 写进 id_token |
| code_challenge / code_challenge_method | varchar(128) / varchar(16) NULL | PKCE |
| expires_ms | i64 | 默认 5 分钟 |
| used / used_ms | bool / i64 NULL | 一次性；重复使用视为攻击，连带撤销换出的 token |
| 审计 5 字段 | | |

### 5.5 `uiam_token` — 已签发令牌

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | |
| jti | varchar(64) UK | 撤销名单靠它 |
| kind | varchar(16) | `access` / `refresh` / `id` |
| session_id / client_id / user_id | varchar(64) / varchar(64) / i64 | |
| scope | varchar(512) | |
| issued_ms / expires_ms | i64 | |
| revoked_ms / revoke_reason | i64 NULL / varchar(64) NULL | |
| 审计 5 字段 | | |

索引 `(expires_ms)`、`(session_id, kind)`；过期 7 天后物理删除。

### 5.6 `uiam_consent` — 用户授权记录

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | |
| user_id / client_id | i64 / varchar(64) | |
| scope | varchar(512) | |
| granted_ms / expires_ms | i64 | `expires_ms = 0` 表示长期 |
| revoked_ms | i64 NULL | |
| 审计 5 字段 | | |

唯一键 `(user_id, client_id)`。第一方应用可配置免确认。

---

## 6. B 域：平台配置

### 6.1 `uiam_option`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | |
| opt_key | varchar(64) UK | `oidc.issuer` / `oidc.default-access-ttl` / `login.max-fail` … |
| opt_value | text | |
| group_name | varchar(32) | 前端按组渲染 |
| value_type | varchar(16) | `string` / `int` / `bool` / `json` |
| remark | varchar(255) | |
| 审计 5 字段 | | |

### 6.2 `uiam_upstream_auth`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | |
| upstream | varchar(32) UK | 目前只有 `adm` |
| base_url | varchar(255) | `http://adm-svr:9007` |
| client_id | varchar(64) | 服务账号 |
| secret_cipher | text | 口令密文 |
| token_cache / token_expires_ms | text NULL / i64 NULL | 缓存的服务 token |
| 审计 5 字段 | | |

**认证路径不用它**；它只服务两件事：① uiam 首次启动时全量初始化 F 域；② 同步管道故障时手工触发全量对账。

---

## 7. C 域：工作台

### 7.1 `uiam_app_favorite`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | |
| user_id / app_id | i64 / i64 | |
| sort_no | int | |
| 审计 5 字段 | | |

唯一键 `(user_id, app_id)`。不存应用名/图标（在 `uiam_role_app` 副本里）。

### 7.2 `uiam_workbench_layout`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | |
| user_id | i64 UK | |
| layout_json | text | 磁贴顺序、折叠状态、主题 |
| 审计 5 字段 | | |

服务端只存不解析——否则每加一个磁贴都要改后端。

---

## 8. D 域：网关配置（gatex-rs）

> **结构化存储，发布时才渲染 TOML**。不存 TOML 文本：文本没法行级编辑、没法做引用校验、没法 diff。
> 唯一例外是 `uiam_gateway_release.content`——渲染结果快照，用于回滚与 diff。

### 8.1 `uiam_gateway`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | |
| code | varchar(64) UK | `gatex-rs-svr00` / `gatex-rs-svr01` |
| name | varchar(128) | |
| env | varchar(32) | `prod`（KV 前缀按环境隔离的预留位） |
| kv_key | varchar(128) | Consul KV 的 data_id，如 `gatex-rs-svr01.toml` |
| hostname | varchar(64) | 容器 hostname（`gatexrs01`），仅展示 |
| published_ports | json | `[{"published":40198,"target":80}]`；00 为空数组 |
| consul_base_url | varchar(255) | `http://consul_svr:8500` |
| enabled / remark | bool / varchar(255) | |
| 审计 5 字段 | | |

**双服务就是两行**：`svr00` 无 publish、监听器只有 `0.0.0.0:80` 无 TLS；`svr01` 有 40198/40199。两份配置独立发布。

### 8.2 `uiam_gateway_listener`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | |
| gateway_id | i64 | |
| kind | varchar(16) | `http` / `tcp` |
| addrs | json | `[{"addr":"0.0.0.0:443","tls":{"cert":"cert/cert.pem","key":"cert/key.pem"}}]` |
| sort_no | int | |
| 审计 5 字段 | | |

**必须独立成表**：`listeners` 是数组、中心给了就整段替换；`addrs` 变化是结构性变更（网关拒绝热更）。独立成表才能做「发布前对比 listener 结构」。

### 8.3 `uiam_gateway_route`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | |
| listener_id | i64 | |
| sort_no | int | 渲染顺序；`Prefix`/`Regex` 第一个匹配生效，顺序即优先级 |
| matcher_type | varchar(16) | `Host` / `Exact` / `Prefix` / `Regex` / `Service` |
| matcher_addr | varchar(128) NULL | |
| matcher_urn | json NULL | `["/adm-rs-web"]` |
| matcher_method / matcher_regex | varchar(16) / varchar(512) NULL | 仅 `Regex` |
| matcher_svc_name | json NULL | 仅 `Service`，`["adm-rs-svr"]` |
| target_type | varchar(16) | `Host` / `LoadBalancer` / `Static` |
| target_addr | varchar(128) NULL | `Host` 用 |
| target_balancer_id | i64 NULL | `LoadBalancer` 用，引用 `uiam_gateway_balancer.id` |
| target_spa | bool | `Static` 用 |
| target_uri_rule | varchar(32) NULL | `StripPrefix` / `Keep` / 改写规则 |
| target_tls_sni | varchar(255) NULL | |
| preserve_host | bool | |
| cors_json | json NULL | `{}` 允许全部；`null` 不开 CORS |
| cache_control | varchar(255) NULL | 静态用 |
| log_json | json NULL | |
| enabled / remark | bool / varchar(255) | |
| 审计 5 字段 | | |

**为什么一张表 + 判别列**：匹配器是封闭枚举，组合固定；拆 5 张表会让「取一个监听器的全部路由」变成 5 次查询 + 内存重排，而顺序恰恰是语义的一部分。

**`target_balancer_id` 是发布校验的关键**：网关侧「引用了不存在的 LB」是硬错误，管理面必须发布前拦住（对应 `validate_app_config` 的报错）。

### 8.4 `uiam_gateway_balancer`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | |
| gateway_id | i64 | |
| code | varchar(64) | `Service` 匹配器会派生 `{code}-{svc}` 实例 |
| type | varchar(16) | `Array` / `SystemConfig` / `DNS` / `Swarm` / `Consul` / `Nacos` |
| service_name / host / port / base_url / tag | … | 按 type 取用 |
| token_cipher | text NULL | Consul ACL token（密文，日志必须脱敏） |
| backends | json NULL | `["50%10.0.0.1:8080","10.0.0.2:8080"]` |
| dns_server / query_name / use_hosts_file | … | `DNS` 用 |
| group_name / namespace_id / nacos_version | … | `Nacos` 用 |
| selection_algorithm | varchar(16) | `RoundRobin` / `Random` |
| update_frequency_ms | i64 | 默认 15000 |
| health_check | json | `{kind,frequency,parallel,consecutive-success,consecutive-failure,http-path,http-host,timeout}` |
| 审计 5 字段 | | |

唯一键 `(gateway_id, code)`。注意：`balancers` 变化在网关侧是**结构性变更**，发布时被 `structural_change()` 拦下 → 走部署流程。

### 8.5 `uiam_gateway_static`

| 字段 | 类型 | 说明 |
|---|---|---|
| id / gateway_id(UK) | i64 | |
| root_dir | varchar(255) | 相对应用目录，如 `static` |
| page_404_path | varchar(255) | 相对静态根，如 `404.html` |
| 审计 5 字段 | | |

### 8.6 `uiam_gateway_cert`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | |
| gateway_id | i64 | |
| name | varchar(64) | |
| cert_path / key_path | varchar(255) | **只存路径**；私钥永不进库、不进快照 |
| sni | varchar(255) NULL | |
| not_after_ms | i64 NULL | 到期提醒 |
| remark | varchar(255) | |
| 审计 5 字段 | | |

唯一键 `(gateway_id, name)`。管理面无法校验证书文件是否存在（文件在网关节点上，见 `validate_app_config` 的边界），只能校验引用完整性。

### 8.7 `uiam_gateway_ops`

| 字段 | 类型 | 说明 |
|---|---|---|
| id / gateway_id(UK) | i64 | |
| health_path / metrics_path | varchar(128) NULL | |
| addrs | json | `["0.0.0.0:9090"]`；空数组 = 跟随业务监听器 |
| 审计 5 字段 | | |

约束（与网关一致）：`addrs` 非空时必须至少配一个路径，否则发布直接拒绝。

### 8.8 `uiam_gateway_release`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | |
| gateway_id | i64 | |
| version | int | 从 1 递增 |
| format | varchar(16) | `toml` |
| content | text | **渲染结果快照**（回滚与 diff 用） |
| checksum | varchar(64) | |
| structural_change | bool | 是否涉及启动期资源 |
| pushed / pushed_ms | bool / i64 NULL | KV 是否写成功 |
| publisher_id | i64 | |
| note | varchar(512) | 发布说明 |
| 审计 5 字段 | | |

唯一键 `(gateway_id, version)`。

**写库与写 KV 的顺序**：先写库（`pushed=false`）→ PUT KV → 回填 `pushed=true`。反过来先写 KV，一旦写库失败，KV 已生效但历史里没有，审计就断了。

---

## 9. E 域：审计

### 9.1 `uiam_audit_log`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | |
| actor_id / actor_name | i64 NULL / varchar(64) | 操作人（系统动作为空） |
| action | varchar(64) | `client.create` / `gateway.publish` / `gateway.rollback` / `session.kick` |
| target_type / target_id | varchar(32) / i64 NULL | |
| before_json / after_json | text NULL | 变更摘要（凭证必须脱敏） |
| result / error_msg | varchar(16) / varchar(512) NULL | |
| ip / user_agent | varchar(64) / varchar(255) | |
| created_ms | i64 | 只增不改，无 updater |

索引 `(created_ms)`、`(actor_id, created_ms)`、`(target_type, target_id)`。

**登录流水不重复记**：`adm_login_log` 已有历史；uiam 记 `uiam_login_attempt`（失败计数）与 `uiam_session`（会话），不再造第三份登录日志。

---

## 10. 关系图

```
【F 域 · dbz 同步的只读副本】
adm 库 ──CDC──▶ uiam_user_auth ─┬─1:N── uiam_user_role ──N:1── uiam_role_perm
                                └─(user_id)              └──N:1── uiam_role_app

【A 域 · 认证核心】
uiam_user_auth ──(user_id)──▶ uiam_session ──1:N── uiam_token
                                    │
uiam_client ──1:N── uiam_auth_code ─┘
       └──────1:N── uiam_consent

【D 域 · 网关配置】
uiam_gateway ──1:N── uiam_gateway_listener ──1:N── uiam_gateway_route ──N:1── uiam_gateway_balancer
     ├──1:1── uiam_gateway_static
     ├──1:1── uiam_gateway_ops
     ├──1:N── uiam_gateway_cert
     └──1:N── uiam_gateway_release
```

删除策略（应用层，不用数据库外键）：

- 删 `uiam_gateway`：级联删 listener/route/balancer/static/ops/cert。
- 删 `uiam_gateway_balancer`：被任何 route 引用则**拒绝**（`RESTRICT`）。
- 删 `uiam_gateway_listener`：级联删其 route。
- `uiam_client` 有 token/consent 时改 `enabled=false`，不物理删。
- **F 域不接受业务删除**：只能由同步接口按 CDC 的 `op=d` 删；手工删会被下次同步补回。

---

## 11. 认证流水线（认证路径零 RPC）

```
① 取用户名口令 → 查 USER_AUTH_CACHE（内存快照）
        │ 快照为空？ → 查 uiam_user_auth（自己的库）→ 回填快照
        │ 表也为空？ → 拒绝登录并告警「身份副本未初始化」
② 校验锁定：uiam_login_attempt（username+ip）是否 locked_until_ms > now
        │ 失败 → fail_count+1，达阈值写 locked_until_ms
③ 比对 SM3(明文 + login_pswd_salt) 与 login_pswd
        │ 失败 → 同上计数
④ 成功 → 清 fail_count，insert uiam_session，publish 会话事件
⑤ 需要授权码时：insert uiam_auth_code
⑥ 换 token：校验 code → 从 USER_PERM_CACHE 取 scope 内的权限 → 签 ES512 JWT → insert uiam_token
```

**全程不调 adm**。adm 挂了，已同步的用户仍能登录；只有「副本初始化」和「同步管道」依赖 adm。

---

## 12. 网关配置发布流水线

```
① 读 uiam_gateway + listener + route + balancer + static + ops
② 渲染成完整 TOML（不是增量——listeners 是整段替换语义）
③ toml::from_str::<AppConfig>()              语法错 → 拒绝
④ gatex_svr::gatex::validate_app_config()    语义错 → 拒绝；warnings 展示给用户
⑤ gatex_svr::config::structural_change()     与上一版 release 比对 → 命中则拒绝，走部署流程
⑥ insert uiam_gateway_release(version+1, content, checksum, pushed=false)
⑦ PUT Consul KV（一个 key、一次写，原子）
⑧ 回填 pushed=true + 写 uiam_audit_log
```

第 ④ 步用的正是 gatex 2.0.8 的 `validate_app_config`：它走网关启动同一个 `build`，所以「管理面说能发布」和「网关能装起来」是同一个答案。

---

## 13. 关键取舍

| # | 取舍 | 理由 |
|---|---|---|
| 1 | 身份数据用 **dbz CDC 落表**，不用「认证时调 adm」 | adm 零改动；uiam 启动与认证都不依赖 adm 可用 |
| 2 | 落表之后再叠 **robotech 本地缓存** | 与 `alarm` / `msg` 同构；热路径零 IO |
| 3 | F 域是**只读副本**，唯一写入方是同步接口 | 两个写入口必然不一致 |
| 4 | F 域主键 = 真源主键（`uiam_user_auth.id = adm_user.id`） | 同步用 upsert，主键对不上就会重复插入 |
| 5 | 只同步认证与授权**必需**字段 | 复制整表等于把 adm 的 schema 也复制过来 |
| 6 | 锁定与失败计数归 uiam（`uiam_login_attempt`） | 校验在哪，锁定就必须在哪，否则永远不触发 |
| 7 | 网关配置结构化存储，发布时才渲染 TOML | 文本没法行级编辑、没法引用校验、没法 diff |
| 8 | `listener` 独立成表 | `listeners` 整段替换，结构变更必须能拦 |
| 9 | 路由 matcher/target 用判别列而非多表 | 匹配器封闭枚举，顺序即语义 |
| 10 | `target_balancer_id` 做引用 | 「LB 不存在」是硬错误，发布前必须拦住 |
| 11 | 证书只存路径 | 私钥不进库、不进快照 |
| 12 | 临时凭证全部落库 | 不新增依赖；可审计、可撤销、多副本一致 |
| 13 | 不做 MFA、不做旧网关、不建节点状态表 | 没有消费者的字段不建 |

---

## 14. 待确认

| # | 问题 | 我的建议 |
|---|---|---|
| 1 | 锁定策略归 uiam 之后，adm 的 `adm_lock_log` 还写吗？ | 不写。uiam 记 `uiam_login_attempt`，adm 只保留历史 |
| 2 | 同步管道用「uiam 自己的接收接口」还是「复用 magic-api 脚本」？现有 4 个 sink 都指向 `magic:9999/sync/*` | **uiam 自己接**：Rust 解析 Debezium envelope 很轻，且不必让 magic 参与身份数据 |
| 3 | F 域初始化：首启用 adm 的 feign 全量拉，还是让新 sink 从 topic 最早位点回放？ | feign 全量拉一次。topic 保留期可能已过，回放不可靠 |
| 4 | `uiam_client.app_id` 关联 `adm_app`：需要吗？ | 需要。工作台要「点应用即已登录」 |
| 5 | 会话并发限制（同一账号最多 N 个 active session）做不做？ | 做。`uiam_session` 已有 `(user_id,status)` 索引，只多一个策略项 |
| 6 | 同步哪些表要定清单：`adm_user` / `adm_role` / `adm_role_user` / `adm_perm` / `adm_role_perm` / `adm_app` / `adm_role_app_scope` | 就这 7 张，落在 F 域的 4 张扁平表上 |

---

## 15. 下一步

1. 本草案评审 → 定稿（§14 六项）
2. 定 dbz 同步清单：topic → uiam 接口 → 目标表（7 张源表 → 4 张副本表）
3. 生成 `uiam/migrations/{pgsql,mysql,sqlite}` 三方言 DDL（三份必须同时存在）
4. 建 `uiam` 工程骨架：`uiam-api` / `uiam-api-client` / `uiam-svr` + `uiam-web`
5. 24 个实体 × 8 文件 = 192 个文件，按域分批：F 域 + A 域（认证闭环）→ D 域（网关配置）→ C/E 域
