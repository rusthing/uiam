//! # 渲染期错误
//!
//! 每种错误都对应一个**不同的人要去做的事**，所以不合并成一个字符串：
//!
//! | 错误 | 谁的问题 | 怎么修 |
//! |---|---|---|
//! | [`RenderError::InvalidJson`] | 库里的 JSON 列写坏了 | 改那一行记录 |
//! | [`RenderError::ExtraToml`] | 实例的「高级配置」语法错 | 改实例配置 |
//! | [`RenderError::SelfCheck`] | 渲染出的 TOML 自己都读不回来 | 报 bug（渲染器的问题） |
//! | [`RenderError::Validate`] | 配置装不起来（正则非法、LB 不存在…） | 按提示改配置行 |
//! | [`RenderError::PreviousContent`] | 上一版发布记录的内容坏了 | 回滚到更早的版本 |
//!
//! 「结构性变更需要重启」**不是错误**，它是可以发布但必须告知用户的信息，
//! 所以放在 [`super::RenderedConfig::structural_change`] 里而不是这里。

use thiserror::Error;

/// 渲染期错误
#[derive(Debug, Error)]
pub enum RenderError {
    /// JSON 列无法反序列化成 gatex 的配置类型
    ///
    /// 带上实体名与行 id，否则一条「invalid type: map」的错误在整棵子树里
    /// 定位不到是哪一行写错了。
    #[error("{entity}#{id} 的 {column} 不是合法的 JSON 配置：{source}")]
    InvalidJson {
        /// 实体名（listener / route / balancer / gateway）
        entity: &'static str,
        /// 行 id
        id: u64,
        /// 列名
        column: &'static str,
        /// serde 的原始错误
        #[source]
        source: serde_json::Error,
    },

    /// 结构化部分序列化成 TOML 失败
    ///
    /// 正常不该发生：能序列化成 JSON 的结构序列化成 TOML 只会因为 TOML 不支持
    /// 某种形状（例如 `null`）而失败。真出现了说明某个字段的 serde 属性有问题。
    #[error("结构化配置序列化成 TOML 失败：{0}")]
    Serialize(#[from] toml::ser::Error),

    /// 实例的 `extra_toml` 语法错误
    #[error("实例 {code} 的高级配置（extra_toml）不是合法 TOML：{source}")]
    ExtraToml {
        /// 实例标识
        code: String,
        /// TOML 解析错误
        #[source]
        source: toml::de::Error,
    },

    /// 合并后的 TOML 反解析回 `AppConfig` 失败
    ///
    /// 这一步是渲染器的**自检**：如果自己渲染出来的东西自己都读不回来，
    /// 推给网关只会让它启动失败。出现在这里说明渲染器有 bug，不是用户配错了。
    #[error("渲染结果无法反解析成 AppConfig（渲染器自检失败）：{source}")]
    SelfCheck {
        /// TOML 解析错误
        #[source]
        source: toml::de::Error,
    },

    /// 试装配失败：这份配置网关装不起来
    ///
    /// 错误文本就是 `validate_app_config` 给出的那句人话，可以直接展示给用户。
    #[error("配置无法装配：{0}")]
    Validate(String),

    /// 上一版发布记录的内容无法解析
    ///
    /// 意味着历史 `content` 已损坏，无法据此判断结构性变更。不静默跳过——
    /// 跳过会让「需要重启」的变更被当成可热更推出去。
    #[error("上一版发布记录（release#{release_id}）的内容无法解析：{source}")]
    PreviousContent {
        /// 发布记录 id
        release_id: u64,
        /// TOML 解析错误
        #[source]
        source: toml::de::Error,
    },
}
