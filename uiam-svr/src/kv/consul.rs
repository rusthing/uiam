//! # Consul KV 客户端
//!
//! 只做两件事：`PUT` 一个 key、`GET` 一个 key。用 Consul 的 HTTP API 直接拼
//! `/v1/kv/{key}`，不引专用 SDK——协议简单到不值得为它加一个依赖。
//!
//! ## 为什么判定这么啰嗦
//!
//! 「发布成功」是会对用户负责的结论。Consul 的 KV PUT 有三种「看着成功其实没成」
//! 的形态，都得分开报：
//!
//! 1. **HTTP 非 2xx**：ACL 拒绝、只读副本、路径写错 —— 响应码能看出来
//! 2. **HTTP 2xx 但响应体是 `false`**：带 `cas` 比较失败时就是这样，状态码 200
//! 3. **请求根本没到**：超时、连接被拒 —— `reqwest` 直接报错
//!
//! 框架里的 `ConfigCenterClient::set_config` 只看第 3 种，第 1、2 种一律当成功。
//! 发布链路不能这么含糊，所以这里逐条判。

use crate::config::ConsulKvConfig;
use crate::kv::KvError;
use base64::prelude::{BASE64_STANDARD, Engine as _};
use serde::Deserialize;
use std::time::Duration;

/// 响应体在错误信息里的最大长度
///
/// Consul 的错误体通常是一行短文本，但代理层可能塞一整页 HTML 回来。
/// 截断是为了让错误信息还能读，不是省内存。
const BODY_LIMIT: usize = 300;

/// # 一次成功写入的结果
///
/// 只有一个 `key`——Consul 的 KV PUT **不返回** `X-Consul-Index`，写入后的
/// 索引只能靠再读一次拿到。需要索引的调用方（发布链路）会在写完之后回读一次，
/// 顺便验证「落地的就是这份字节流」。
#[derive(Debug, Clone)]
pub struct KvWrite {
    /// 实际写入的完整 key（含环境前缀）
    pub key: String,
}

/// # 一次成功读取的结果
#[derive(Debug, Clone)]
pub struct KvRead {
    /// key 的当前内容
    pub content: String,
    /// Consul 的 `ModifyIndex`
    pub modify_index: u64,
}

/// Consul KV 返回的单条记录
///
/// Consul 的字段是 `PascalCase`，且 `Value` 是 base64——它不假设值一定是文本。
#[derive(Deserialize)]
struct KvEntry {
    #[serde(rename = "Value")]
    value: Option<String>,
    #[serde(rename = "ModifyIndex")]
    modify_index: u64,
}

/// # Consul KV 客户端
///
/// 内部持有一个 `reqwest::Client`（连接池复用），所以应当长期持有、不要每次
/// 发布都新建。见 [`super::get_consul_kv`]。
#[derive(Debug)]
pub struct ConsulKv {
    /// HTTP 客户端（带超时）
    client: reqwest::Client,
    /// Consul HTTP 地址，末尾的 `/` 已去掉
    base_url: String,
    /// KV 路径前缀（含结尾 `/`），如 `dev/`；空串表示不加前缀
    key_prefix: String,
}

impl ConsulKv {
    /// # 按配置创建客户端
    ///
    /// ## 参数
    /// - `config`：`[consul]` 段（地址 + 前缀 + 超时）
    ///
    /// ## 返回值
    /// 客户端实例
    ///
    /// ## 错误
    /// - 地址不是 `http://` / `https://` 开头 → [`KvError::BadBaseUrl`]
    /// - 前缀非空但不以 `/` 结尾 → [`KvError::BadKeyPrefix`]
    /// - 超时为 0 → [`KvError::Client`]
    pub fn new(config: &ConsulKvConfig) -> Result<Self, KvError> {
        let base_url = config.base_url.trim().trim_end_matches('/').to_string();
        if !(base_url.starts_with("http://") || base_url.starts_with("https://")) {
            return Err(KvError::BadBaseUrl(config.base_url.clone()));
        }
        let key_prefix = config.key_prefix.trim().to_string();
        if !key_prefix.is_empty() && !key_prefix.ends_with('/') {
            return Err(KvError::BadKeyPrefix(key_prefix));
        }
        if config.timeout_ms == 0 {
            return Err(KvError::Client("timeout-ms 不能为 0".to_string()));
        }
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(config.timeout_ms))
            .build()
            .map_err(|err| KvError::Client(err.to_string()))?;
        Ok(Self {
            client,
            base_url,
            key_prefix,
        })
    }

    /// # 把库里的裸 key 补成 KV 里的完整 key
    ///
    /// 库里 `consul_key` 存的是 `gatex-rs-svr.toml`，KV 里的实际路径是
    /// `dev/gatex-rs-svr.toml`。前缀来自部署配置（见 `ConsulKvConfig::key_prefix`）。
    ///
    /// ## 参数
    /// - `key`：实例上配的 `consul_key`（不含前缀）
    ///
    /// ## 返回值
    /// 完整 key
    pub fn full_key(&self, key: &str) -> String {
        format!("{}{}", self.key_prefix, key)
    }

    /// # 拼出某个 key 的请求地址
    ///
    /// Consul 的 KV key 直接放在路径里（`/v1/kv/a/b/c` 的 key 就是 `a/b/c`），
    /// 所以这里不做百分号编码——做了反而会让 `/` 变成 `%2F`，Consul 认不出来。
    /// 代价是 key 不能含空白和 `?`、`#`，用 [`Self::check_key`] 提前拦掉。
    fn url(&self, key: &str) -> Result<(String, String), KvError> {
        let full = self.full_key(key);
        Self::check_key(&full)?;
        Ok((format!("{}/v1/kv/{}", self.base_url, full), full))
    }

    /// # 校验 key
    ///
    /// ## 参数
    /// - `key`：**完整** key（已含前缀），因为前缀里可能有 `/`
    ///
    /// ## 返回值
    /// 合法返回 `Ok(())`
    ///
    /// ## 错误
    /// 空串或含非法字符返回 [`KvError::BadKey`]
    ///
    /// ## 说明
    /// 允许的字符集就是「网关配置文件的常见命名」：字母、数字、`-`、`_`、`.`、
    /// `/`。挡掉空白和 URL 保留字符，剩下的都能原样放进路径。
    fn check_key(key: &str) -> Result<(), KvError> {
        let ok = !key.is_empty()
            && key.chars().all(|ch| {
                ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '/')
            });
        if ok { Ok(()) } else { Err(KvError::BadKey(key.to_string())) }
    }

    /// # 写入一个 key
    ///
    /// Consul 的 KV 写入是**整值覆盖**，没有「部分更新」——这正是我们要的语义：
    /// 每次发布都是完整 TOML，推上去就该把旧值整体换掉。
    ///
    /// ## 参数
    /// - `key`：实例的 `consul_key`（**裸 key**，不含环境前缀；前缀由客户端补）
    /// - `content`：完整内容
    ///
    /// ## 返回值
    /// [`KvWrite`]：实际写入的完整 key
    ///
    /// ## 错误
    /// - key 非法 → [`KvError::BadKey`]
    /// - 请求发不出去 / 超时 → [`KvError::Transport`]
    /// - Consul 返回非 2xx → [`KvError::Rejected`]
    /// - Consul 返回 2xx 但响应体不是 `true` → [`KvError::NotApplied`]
    ///
    /// ## 示例
    /// ```ignore
    /// let kv = get_consul_kv()?;
    /// let written = kv.put("gatex-rs-svr.toml", &toml).await?;
    /// println!("写到 {}", written.key);
    /// ```
    pub async fn put(&self, key: &str, content: &str) -> Result<KvWrite, KvError> {
        let (url, full_key) = self.url(key)?;
        let response = self
            .client
            .put(&url)
            .body(content.to_string())
            .send()
            .await
            .map_err(|source| KvError::Transport {
                url: url.clone(),
                source,
            })?;

        let status = response.status();
        let body = response.text().await.map_err(|source| KvError::Transport {
            url: url.clone(),
            source,
        })?;

        if !status.is_success() {
            return Err(KvError::Rejected {
                key: full_key,
                status: status.as_u16(),
                body: truncate(&body),
            });
        }
        // Consul 的 KV PUT 成功时响应体就是 `true`；带 cas 且比较失败时是
        // `false` 配 200。不判这一条，「发布成功」就可能是假的。
        if body.trim() != "true" {
            return Err(KvError::NotApplied {
                key: full_key,
                body: truncate(&body),
            });
        }

        Ok(KvWrite { key: full_key })
    }

    /// # 读一个 key
    ///
    /// ## 参数
    /// - `key`：实例的 `consul_key`（**裸 key**，不含环境前缀）
    ///
    /// ## 返回值
    /// - `Ok(Some(_))`：key 存在
    /// - `Ok(None)`：key 不存在（Consul 返回 404）
    ///
    /// ## 错误
    /// - key 非法 → [`KvError::BadKey`]
    /// - 请求失败 → [`KvError::Transport`]
    /// - Consul 返回非 2xx 且非 404 → [`KvError::Rejected`]
    /// - 响应结构对不上 → [`KvError::BadResponse`]
    /// - 值不是合法 UTF-8 → [`KvError::NotUtf8`]
    pub async fn get(&self, key: &str) -> Result<Option<KvRead>, KvError> {
        let (url, full_key) = self.url(key)?;
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|source| KvError::Transport {
                url: url.clone(),
                source,
            })?;

        let status = response.status();
        // 404 = key 不存在。这是正常情况（第一次发布之前 KV 是空的），
        // 不是错误——调用方要区分「没有」和「读不到」。
        if status.as_u16() == 404 {
            return Ok(None);
        }
        let body = response.text().await.map_err(|source| KvError::Transport {
            url: url.clone(),
            source,
        })?;
        if !status.is_success() {
            return Err(KvError::Rejected {
                key: full_key,
                status: status.as_u16(),
                body: truncate(&body),
            });
        }

        let entries: Vec<KvEntry> = serde_json::from_str(&body)
            .map_err(|err| KvError::BadResponse(format!("{err}；响应体：{}", truncate(&body))))?;
        let Some(entry) = entries.into_iter().next() else {
            return Ok(None);
        };
        let Some(encoded) = entry.value else {
            // Consul 允许「只有 key 没有值」的条目（目录占位）。当成空内容。
            return Ok(Some(KvRead {
                content: String::new(),
                modify_index: entry.modify_index,
            }));
        };
        let bytes = BASE64_STANDARD
            .decode(encoded.as_bytes())
            .map_err(|err| KvError::BadResponse(format!("Value 不是合法 base64：{err}")))?;
        let content = String::from_utf8(bytes).map_err(|err| KvError::NotUtf8 {
            key: full_key,
            reason: err.to_string(),
        })?;

        Ok(Some(KvRead {
            content,
            modify_index: entry.modify_index,
        }))
    }
}

/// # 截断响应体
///
/// 按**字符**边界截，不按字节——直接切字节会把多字节 UTF-8 切坏，
/// 拼进错误信息时变成乱码。
fn truncate(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.chars().count() <= BODY_LIMIT {
        return trimmed.to_string();
    }
    let head: String = trimmed.chars().take(BODY_LIMIT).collect();
    format!("{head}…（共 {} 字符，已截断）", trimmed.chars().count())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造一份合法配置，只改需要测的字段
    fn config(base_url: &str, key_prefix: &str) -> ConsulKvConfig {
        ConsulKvConfig {
            base_url: base_url.to_string(),
            key_prefix: key_prefix.to_string(),
            timeout_ms: 5000,
        }
    }

    #[test]
    fn 地址必须是_http_或_https() {
        let err = ConsulKv::new(&config("consul:8500", "")).unwrap_err();
        assert!(matches!(err, KvError::BadBaseUrl(_)), "{err:?}");

        assert!(ConsulKv::new(&config("http://consul:8500", "")).is_ok());
        assert!(ConsulKv::new(&config("https://consul:8500", "")).is_ok());
    }

    #[test]
    fn 前缀必须以斜杠结尾() {
        // `dev` 到底是前缀还是 key 的一部分，不能靠猜——直接拒绝。
        let err = ConsulKv::new(&config("http://consul:8500", "dev")).unwrap_err();
        assert!(matches!(err, KvError::BadKeyPrefix(_)), "{err:?}");

        assert!(ConsulKv::new(&config("http://consul:8500", "dev/")).is_ok());
        assert!(ConsulKv::new(&config("http://consul:8500", "")).is_ok());
    }

    #[test]
    fn 超时为_0_被拒绝() {
        let mut cfg = config("http://consul:8500", "");
        cfg.timeout_ms = 0;
        assert!(matches!(
            ConsulKv::new(&cfg).unwrap_err(),
            KvError::Client(_)
        ));
    }

    #[test]
    fn 完整_key_要带前缀() {
        let kv = ConsulKv::new(&config("http://consul:8500", "dev/")).unwrap();
        assert_eq!(kv.full_key("gatex-rs-svr.toml"), "dev/gatex-rs-svr.toml");

        let bare = ConsulKv::new(&config("http://consul:8500", "")).unwrap();
        assert_eq!(bare.full_key("gatex-rs-svr.toml"), "gatex-rs-svr.toml");
    }

    #[test]
    fn 地址末尾的斜杠被去掉() {
        // `http://consul:8500/` 和 `http://consul:8500` 必须拼出同一个 URL，
        // 否则会出现 `//v1/kv/...`
        let kv = ConsulKv::new(&config("http://consul:8500/", "")).unwrap();
        assert_eq!(kv.base_url, "http://consul:8500");
        let (url, _) = kv.url("a.toml").unwrap();
        assert_eq!(url, "http://consul:8500/v1/kv/a.toml");
    }

    #[test]
    fn 非法_key_被拒绝() {
        let kv = ConsulKv::new(&config("http://consul:8500", "")).unwrap();
        for bad in ["", "a b.toml", "a?b", "a#b", "中文.toml"] {
            let err = kv.url(bad).unwrap_err();
            assert!(matches!(err, KvError::BadKey(_)), "{bad} 应被拒绝：{err:?}");
        }
        // 斜杠是合法的（环境前缀、目录式 key 都靠它）
        assert!(kv.url("dev/a.toml").is_ok());
    }

    #[test]
    fn 响应体按字符边界截断() {
        // 直接切字节会把多字节字符切坏，拼进错误信息时变成乱码
        let long = "错".repeat(BODY_LIMIT + 10);
        let cut = truncate(&long);
        assert!(cut.starts_with("错错错"));
        assert!(cut.contains("已截断"));
        assert!(!cut.contains('\u{FFFD}'), "截断不能产生替换字符");

        assert_eq!(truncate("  true \n"), "true");
    }
}
