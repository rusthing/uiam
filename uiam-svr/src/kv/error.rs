//! # KV 下发错误
//!
//! 每个变体对应一个「谁去修」，这样发布失败时用户看到的那句话就已经能指向
//! 下一步动作，不需要再去翻服务端日志：
//!
//! | 变体 | 谁去修 |
//! |---|---|
//! | [`KvError::BadBaseUrl`] / [`KvError::BadKey`] / [`KvError::BadKeyPrefix`] | 部署配置 / 实例的 `consul_key` 填错了 |
//! | [`KvError::Client`] | 进程环境（TLS 后端、系统代理） |
//! | [`KvError::Transport`] | 网络或 Consul 挂了 |
//! | [`KvError::Rejected`] / [`KvError::NotApplied`] | Consul 收到了但没答应：ACL、只读副本、CAS 失败 |
//! | [`KvError::BadResponse`] | Consul 版本与预期不符（响应结构对不上） |
//! | [`KvError::NotUtf8`] | KV 里存了二进制，不是配置文件 |
//! | [`KvError::NotInitialized`] | 服务启动时没读到 `[consul]` 段 |

/// # KV 下发错误
#[derive(Debug, thiserror::Error)]
pub enum KvError {
    /// Consul 地址不是合法的 http(s) URL
    #[error("Consul 地址 [{0}] 不是合法的 http(s) URL")]
    BadBaseUrl(String),

    /// 建 HTTP 客户端失败（TLS 后端缺失、代理配置非法等）
    #[error("无法创建 Consul HTTP 客户端：{0}")]
    Client(String),

    /// key 含非法字符
    #[error("Consul key [{0}] 含非法字符：只允许字母、数字、`-`、`_`、`.`、`/`")]
    BadKey(String),

    /// KV 路径前缀不是以 `/` 结尾
    #[error("Consul KV 路径前缀 [{0}] 必须以 `/` 结尾（例如 `dev/`），否则 `dev` 到底是前缀还是 key 的一部分无法区分")]
    BadKeyPrefix(String),

    /// 请求根本没发出去，或响应读到一半断了
    #[error("请求 Consul 失败（{url}）：{source}")]
    Transport {
        /// 请求地址
        url: String,
        /// 底层错误
        source: reqwest::Error,
    },

    /// Consul 返回了非 2xx
    #[error("Consul 拒绝写入 [{key}]：HTTP {status}，响应体：{body}")]
    Rejected {
        /// 目标 key
        key: String,
        /// HTTP 状态码
        status: u16,
        /// 响应体（已截断）
        body: String,
    },

    /// Consul 返回 2xx 但明确表示没写进去（响应体不是 `true`）
    ///
    /// Consul 的 KV PUT 成功时响应体就是 `true`。带 `cas` 参数比较失败时是
    /// `false`，这类「看着成功其实没写」的情况必须单独报出来。
    #[error("Consul 未接受写入 [{key}]：响应体为 [{body}]，期望 [true]")]
    NotApplied {
        /// 目标 key
        key: String,
        /// 响应体（已截断）
        body: String,
    },

    /// 响应结构对不上（版本不匹配）
    #[error("Consul 响应无法解析：{0}")]
    BadResponse(String),

    /// KV 里的值不是合法 UTF-8
    #[error("Consul KV [{key}] 的内容不是合法 UTF-8：{reason}")]
    NotUtf8 {
        /// 目标 key
        key: String,
        /// 解码失败原因
        reason: String,
    },

    /// 客户端尚未初始化
    #[error("KV 客户端尚未初始化：服务启动时没有读到 [consul] 配置段")]
    NotInitialized,
}
