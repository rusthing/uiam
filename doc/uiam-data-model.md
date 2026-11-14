# uiam 一期数据模型（网关配置）

> **范围**：只覆盖 `uiam-plan.md` 第 1 步（网关管理面）的 5 张表。
> 认证、工作台的表等做到那一步再设计——现在写出来大概率要改。
> 旧的完整草案（含已作废的「uiam 自己校验密码」假设）见 `uiam-data-model-v2-full.md`，仅作历史参考。

---

## 1. 设计原则

### 1.1 复杂结构用 JSON 列，不拆字段

gatex 的 `RouteMatcherConfig` 有 5 种变体（`host` / `exact` / `prefix` / `regex` / `service`），`ToConfig` 有 `host` / `load-balancer` / `static` 等多种，字段差异很大。硬拆成列的结果是**一张表几十列、一半永远为空**，且每加一种变体就要加一轮迁移。

所以：**匹配器、目标、日志各自一个 JSON 列**，前端用表单生成 JSON，渲染时 `serde_json::from_str::<RouteMatcherConfig>()` 再序列化成 TOML。类型安全由 Rust 保证，数据库只当容器。

只把**需要索引、排序、引用校验**的部分拆成列。

### 1.2 表名与审计字段

沿用全项目规范：`uiam_` 前缀，审计字段 `id`(i64) / `creater_id` / `create_ms` / `updater_id` / `update_ms`（注意是 **creater** 不是 creator）。

### 1.3 JSON 列统一用 text

PostgreSQL 有 `jsonb`、MySQL 有 `json`，但三方言要保持 DDL 同构，且代码层读出来都是 `String` 再 serde。用 `text` 最省事，不需要为方言写三套映射。

---

## 2. 表清单

| # | 表 | 对应 `AppConfig` 的哪部分 | 行数量级 |
|---|---|---|---|
| ① | `uiam_gateway` | `pingora-conf` / `ops` / `static` / `upstream-error` | 个位数 |
| ② | `uiam_gateway_listener` | `listeners` + `tcp-listeners` | 个位数 |
| ③ | `uiam_gateway_route` | `listeners[].routes` / `tcp-listeners[].routes` | 几十 |
| ④ | `uiam_gateway_balancer` | `balancers` | 几个 |
| ⑤ | `uiam_gateway_release` | 无（发布产物，含渲染出的完整 TOML） | 每次发布 +1 |

**没有 `uiam_gateway_cert`**：证书在 `ListenerAddrConfig.tls` 里，是 listener 的一部分，不是独立实体。
**没有 `uiam_gateway_ops` / `_static`**：各 2~3 个字段，独立成表是负资产。
**没有节点状态表**：节点在线状态从 Consul 服务目录读，是运行时数据。

---

## 3. 逐表设计

### 3.1 `uiam_gateway` — 网关实例

一个实例对应 Consul KV 里的一个 key，也对应一组 pingora 进程。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | |
| code | varchar(50) | 实例标识，如 `svr01`、`svr00`；UK |
| name | varchar(50) | 展示名 |
| consul_key | varchar(200) | KV 的完整 key；UK |
| extra_toml | text NULL | `pingora-conf` 等无法结构化的部分，TOML 文本 |
| ops_json | text NULL | `OpsConfig`：`health_path` / `metrics_path` / `addrs` |
| static_json | text NULL | `StaticConfig`：`root_dir` / `page_404_path` |
| upstream_error_json | text NULL | `UpstreamErrorConfig` |
| remark | varchar(200) NULL | |
| enabled | bool | 停用的实例不参与发布 |
| 审计字段 | | |

**为什么 `pingora-conf` 用 TOML 文本而不是 JSON 列**：`ServerConf` 是 pingora 自己的胖结构，几十个字段且随版本变化，全落表既无意义也跟不上上游。存一段 TOML，渲染时 parse 成 `toml::Value` 合并即可。用户在界面上看到的是「高级配置」文本域。

### 3.2 `uiam_gateway_listener` — 监听器

HTTP 与 TCP 的 listener 结构同构（都是 `addrs` + `routes`），用 `kind` 区分，不建两张表。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | |
| gateway_id | i64 | 所属实例 |
| kind | i16 | 1 = http，2 = tcp |
| sort_no | i32 | 渲染顺序（`listeners` 是数组，顺序即语义） |
| addrs_json | text | `Vec<ListenerAddrConfig>`，含 `addr` 与可选 `tls` |
| remark | varchar(200) NULL | |
| enabled | bool | 停用的不参与渲染 |
| 审计字段 | | |

索引 `(gateway_id, kind, sort_no)`。

**为什么 listener 必须独立成表**：`listeners` 在 gatex 里是**整段替换**语义，增减 listener 属于结构性变更（需要重启而非热更新）。独立成表才能在做结构比对时精确到行。

### 3.3 `uiam_gateway_route` — 路由

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | |
| listener_id | i64 | 所属监听器 |
| sort_no | i32 | 匹配顺序（**顺序即语义**，前面的先匹配） |
| name | varchar(100) | 便于人看的名字，如「adm 后台接口」 |
| matcher_json | text | `RouteMatcherConfig` |
| to_json | text | `ToConfig` |
| log_json | text NULL | `LogConfig`，为空时用默认 |
| enabled | bool | |
| 审计字段 | | |

索引 `(listener_id, sort_no)`。

**为什么不给 matcher 加索引列**：查询场景只有「按 listener 列出全部路由」，没有「按前缀搜路由」的需求。真要搜，前端拿到列表自己过滤即可。

### 3.4 `uiam_gateway_balancer` — 负载均衡器

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | |
| gateway_id | i64 | 所属实例（`balancers` 是全局 map，不分 listener） |
| name | varchar(100) | 被 `to.type = "load-balancer"` 引用的名字 |
| config_json | text | `BalancerConfig`：算法、后端列表、健康检查 |
| remark | varchar(200) NULL | |
| enabled | bool | |
| 审计字段 | | |

UK `(gateway_id, name)`。

**`name` 必须独立成列**：发布前要校验「route 引用的 LB 存在」，这是硬错误，必须在写库阶段拦住，不能等到网关启动。

### 3.5 `uiam_gateway_release` — 发布版本

| 字段 | 类型 | 说明 |
|---|---|---|
| id | i64 PK | |
| gateway_id | i64 | |
| version | i32 | 从 1 递增 |
| content | text | 渲染出的**完整** TOML |
| checksum | varchar(64) | sha256 hex，用于「内容没变就不重复推」 |
| pushed | bool | 是否已推到 Consul |
| pushed_ms | i64 NULL | 推送成功时间 |
| creater_id / create_ms | | 谁在什么时候发的 |

UK `(gateway_id, version)`，索引 `(gateway_id, create_ms desc)`。

**`content` 是唯一存渲染结果的地方**。回滚 = 把历史版本的 `content` 重新 PUT 一次，不需要重新渲染——因为渲染依赖的配置行可能已经变了，重渲染得到的东西和当初发布的不是一回事。

**发布 ≠ 生效**：`pushed=true` 只代表 KV 写成功。网关是否真的加载了，要看网关侧日志或运维端点。

---

## 4. 渲染规则（库 → TOML）

### 4.1 `AppConfig` 不能直接序列化

gatex 的 `AppConfig` 只 derive 了 `Deserialize`，没有 `Serialize`。所以不能「读库 → 构造 AppConfig → 序列化」。

做法：定义一个本地的可序列化结构，字段类型全部复用 gatex 的 config 类型：

```rust
#[derive(Serialize)]
#[serde(rename_all = "kebab-case")]
struct RenderableAppConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pingora_conf: Option<toml::Value>,   // 来自 extra_toml
    balancers: HashMap<String, BalancerConfig>,
    r#static: StaticConfig,
    listeners: Vec<ListenerConfig>,
    tcp_listeners: Vec<TcpListenerConfig>,
    upstream_error: UpstreamErrorConfig,
    ops: OpsConfig,
}
```

`toml::to_string_pretty` 输出。

### 4.2 `extra_toml` 用 `toml::Value` 合并，不字符串拼接

```rust
let mut root = toml::Value::try_from(&renderable)?;   // 结构化部分
if let Some(extra) = gateway.extra_toml {
    let extra: toml::Value = toml::from_str(&extra)?;  // 语法错在这里就炸
    merge(&mut root, extra);                           // 只补缺失的顶层键
}
```

字符串拼接会把语法错误留到网关启动时才暴露，而且没法处理缩进和转义。

### 4.3 渲染后的自检

渲染完立刻 `toml::from_str::<AppConfig>(&content)`。这一步不过，后面的 `validate_app_config` 都不用跑。

---

## 5. 发布流水线

```
① 读 gateway + listener + route + balancer（enabled = true，按 sort_no）
② 渲染完整 TOML（§4）
③ toml::from_str::<AppConfig>()              语法错 → 拒绝
④ gatex_svr::gatex::validate_app_config()    语义错 → 拒绝；warnings 展示给用户
⑤ gatex_svr::config::structural_change()     与上一版 release 比对
                                              命中 → 拒绝，提示需要重启网关
⑥ insert uiam_gateway_release(version+1, content, checksum, pushed=false)
⑦ PUT Consul KV（一个 key、一次写，原子）
⑧ 回填 pushed=true + pushed_ms + 写审计
```

第 ④ 步用的是 gatex 2.0.8 新增的 `validate_app_config()`：它走网关启动同一个 `build`，只是把负载均衡器解析器换成只解析不注册的版本。所以「管理面说能发布」和「网关能装起来」是同一个答案。

第 ⑤ 步的必要性：`listeners` / `ops.addrs` 的增减属于结构性变更，gatex 遇到时走优雅重启而非热更新。静默推送会让用户以为「点一下就生效」，实际进程正在重启。

---

## 6. 字段对照表（防止漏字段）

`AppConfig` 七个顶层字段，逐个确认落点：

| AppConfig 字段 | 落点 | 备注 |
|---|---|---|
| `pingora-conf` | `uiam_gateway.extra_toml` | TOML 文本 |
| `balancers` | `uiam_gateway_balancer` | `name` 独立成列 |
| `static` | `uiam_gateway.ops_json` 同级的 `static_json` | 2 个字段 |
| `listeners` | `uiam_gateway_listener`(kind=1) + `_route` | |
| `tcp-listeners` | `uiam_gateway_listener`(kind=2) + `_route` | 与 http 同构 |
| `upstream-error` | `uiam_gateway.upstream_error_json` | |
| `ops` | `uiam_gateway.ops_json` | 3 个字段 |

**没有遗漏**。gatex 以后加新的顶层字段时，这张表要同步更新——这是唯一能防止「新字段没地方存」的检查点。

---

## 7. 删除策略

应用层实现，不用数据库外键（与项目其它服务一致）。

| 操作 | 策略 |
|---|---|
| 删 `uiam_gateway` | 级联删其 listener / route / balancer / release |
| 删 `uiam_gateway_listener` | 级联删其 route |
| 删 `uiam_gateway_balancer` | 被任何 route 的 `to_json.name` 引用则**拒绝** |
| 删 `uiam_gateway_route` | 直接删，无引用方 |
| 删 `uiam_gateway_release` | **禁止物理删**，只保留 |

---

## 8. 一期不做的表

| 曾考虑 | 不做 / 推迟的理由 |
|---|---|
| `uiam_gateway_cert` | 证书是 listener 的 `tls` 字段，不是独立实体 |
| `uiam_gateway_node` | 节点状态从 Consul 服务目录实时读，落库必然过期 |
| `uiam_audit_log` | 一期先记在 `uiam_gateway_release` 的 `creater_id` 上；等有第二个写操作域了再建统一审计表，避免现在设计出用不上的 `target_type` 枚举 |
| 认证相关 6 表 | 第 2 步再设计 |
| 工作台 2 表 | 第 3 步再设计 |

---

## 9. 下一步

1. 本设计评审通过 → 生成 `uiam/migrations/{pgsql,mysql,sqlite}` 三方言 DDL
2. 建工程骨架（规划第 0 步）
3. 按表实现 5 个实体 × 8 文件
4. 实现渲染器 + 发布流水线
