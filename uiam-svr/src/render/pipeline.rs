//! # 渲染流水线
//!
//! 一次渲染要连续回答四个问题，任何一个答不上来都不允许发布：
//!
//! 1. **结构化部分能序列化吗** → [`RenderInput::to_renderable`]
//! 2. **`extra_toml` 合并进去还合法吗** → `toml::Table` 合并 + 重新序列化
//! 3. **渲染结果自己读得回来吗** → `toml::from_str::<AppConfig>` 自检
//! 4. **网关装得起来吗** → [`validate_app_config`] 试装配
//!
//! 第五件事不是「能不能发」而是「发出去要不要重启」：拿上一版发布记录的
//! `content` 跟本次结果做 [`structural_change`] 比对。它**不是错误**——
//! 结论要交给调用方去提示用户，不能在这里静默拦掉。

use crate::render::{RenderError, RenderInput};
use gatex_svr::config::{AppConfig, structural_change};
use gatex_svr::gatex::{ValidateReport, validate_app_config};
use sha2::{Digest, Sha256};

/// # 上一版发布记录
///
/// 只需要 `content` 与 `id`：`content` 用来做结构比对，`id` 只用于错误信息
/// 定位（「上一版是哪一条读不懂」）。
#[derive(Debug, Clone)]
pub struct PreviousRelease {
    /// 发布记录 id
    pub id: u64,
    /// 渲染出的完整 TOML
    pub content: String,
}

/// # 渲染结果
///
/// 已经过自检与试装配，可以直接落库、可以直接 PUT 到 Consul KV。
#[derive(Debug, Clone)]
pub struct RenderedConfig {
    /// 最终 TOML 文本（结构化部分 + `extra_toml` 合并后）
    pub toml: String,
    /// `sha256(toml)` 的十六进制串
    pub checksum: String,
    /// 从 `toml` 反解析回来的配置，供后续比对与推演使用
    ///
    /// 不是「另外算一份」——它就是 `toml` 这个字符串解析出来的东西，
    /// 所以拿它做判断与网关读 KV 得到的结果完全一致。
    pub app_config: AppConfig,
    /// 试装配报告（监听器/路由/LB 数量 + 告警）
    pub report: ValidateReport,
    /// 结构性变更说明：`Some` 表示这次发布**需要重启网关**才能生效
    pub structural_change: Option<String>,
    /// 全部告警：渲染期告警 + `extra_toml` 被忽略的键 + 试装配告警
    pub warnings: Vec<String>,
}

/// # 渲染一份可发布的配置
///
/// ## 参数
/// - `input`：一个实例的整棵子树
/// - `previous`：上一版发布记录；首次发布传 `None`（不做结构比对，
///   `structural_change` 为 `None`——首版总是要重启的，调用方按「首次发布」处理即可）
///
/// ## 返回值
/// [`RenderedConfig`]：TOML 文本、摘要、解析结果、试装配报告、结构变更说明、告警
///
/// ## 错误
/// - [`RenderError::InvalidJson`]：某个 JSON 列不是合法配置
/// - [`RenderError::ExtraToml`]：实例的高级配置不是合法 TOML
/// - [`RenderError::SelfCheck`]：渲染器自检失败（bug）
/// - [`RenderError::Validate`]：这份配置网关装不起来
/// - [`RenderError::PreviousContent`]：上一版发布记录的内容坏了
///
/// ## 关于 `extra_toml` 只补缺失的键
///
/// 结构化字段（`listeners` / `tcp-listeners` / `balancers` / `static` / `ops` /
/// `upstream-error`）由数据库渲染，`extra_toml` 只能补**顶层键不存在**的部分。
/// 这样「界面上的监听器列表」和「KV 里的 listeners」永远是同一份东西——
/// 否则用户在高级配置里手写一段 `listeners` 就能把界面上的配置整段盖掉，
/// 而且下次发布又会被渲染结果顶回去，两边来回打架。
///
/// 被忽略的键不会静默丢弃，会进 `warnings`。
pub fn render(
    input: &RenderInput,
    previous: Option<&PreviousRelease>,
) -> Result<RenderedConfig, RenderError> {
    let prepared = input.to_renderable()?;
    let mut warnings = prepared.warnings;

    // ---- 一、结构化部分 → TOML ----
    let base_toml = toml::to_string_pretty(&prepared.app)?;

    // ---- 二、合并 extra_toml（只补缺失的顶层键）----
    let merged_toml = merge_extra_toml(
        &base_toml,
        input.gateway.extra_toml.as_deref(),
        &input.gateway.code,
        &mut warnings,
    )?;

    // ---- 三、自检：自己渲染的东西自己读得回来 ----
    let app_config: AppConfig = toml::from_str(&merged_toml)
        .map_err(|source| RenderError::SelfCheck { source })?;

    // ---- 四、试装配：网关装得起来 ----
    let report = validate_app_config(&app_config)
        .map_err(|err| RenderError::Validate(err.to_string()))?;
    warnings.extend(report.warnings.iter().cloned());

    // ---- 五、结构比对：这次发布要不要重启 ----
    let structural = match previous {
        None => None,
        Some(previous) => {
            let old: AppConfig = toml::from_str(&previous.content).map_err(|source| {
                RenderError::PreviousContent {
                    release_id: previous.id,
                    source,
                }
            })?;
            structural_change(&old, &app_config)
        }
    };

    Ok(RenderedConfig {
        checksum: checksum(&merged_toml),
        toml: merged_toml,
        app_config,
        report,
        structural_change: structural,
        warnings,
    })
}

/// # 把 `extra_toml` 合并进渲染结果
///
/// ## 参数
/// - `base_toml`：结构化部分序列化出的 TOML
/// - `extra_toml`：实例的高级配置；`None` / 空串 / 全空白都表示没有
/// - `code`：实例标识，仅用于错误信息
/// - `warnings`：被忽略的键追加到这里
///
/// ## 返回值
/// 合并后的 TOML 文本
///
/// ## 错误
/// - [`RenderError::ExtraToml`]：`extra_toml` 不是合法 TOML，或无法重新序列化
fn merge_extra_toml(
    base_toml: &str,
    extra_toml: Option<&str>,
    code: &str,
    warnings: &mut Vec<String>,
) -> Result<String, RenderError> {
    let mut base: toml::Table =
        toml::from_str(base_toml).map_err(|source| RenderError::SelfCheck { source })?;

    // 没有高级配置时也要走一遍 `Table` 再序列化：否则「有没有 extra_toml」
    // 会让同一份配置渲染出两种键序，checksum 随之一变，白白多推一次
    let extra_text = extra_toml.map(str::trim).unwrap_or_default();
    if extra_text.is_empty() {
        return Ok(toml::to_string_pretty(&base)?);
    }

    let extra: toml::Table =
        toml::from_str(extra_text).map_err(|source| RenderError::ExtraToml {
            code: code.to_string(),
            source,
        })?;

    for (key, value) in extra {
        if base.contains_key(&key) {
            warnings.push(format!(
                "高级配置里的 [{key}] 被忽略：该段由结构化数据渲染，请在界面上修改对应记录"
            ));
        } else {
            base.insert(key, value);
        }
    }

    Ok(toml::to_string_pretty(&base)?)
}

/// # 计算文本的 sha256 摘要
///
/// 十六进制小写、64 字符。发布链路里有两处要用同一套算法：
/// 渲染时算「这次渲染的内容摘要」，发布前算「KV 里现在那份内容的摘要」——
/// 两者必须能直接比，所以抽成公开函数而不是各算各的。
///
/// ## 参数
/// - `text`：待摘要的文本（渲染出的 TOML）
///
/// ## 返回值
/// 64 字符的十六进制串
pub fn checksum(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::RenderInput;
    use uiam_api::dic::ListenerKind;
    use uiam_api::vo::{
        UiamGatewayBalancerVo, UiamGatewayListenerVo, UiamGatewayRouteVo, UiamGatewayVo,
    };

    /// 构造一个最小可发布的实例：1 个 HTTP 监听器 + 1 条前缀路由 + 1 个 LB
    fn sample_input() -> RenderInput {
        RenderInput {
            gateway: UiamGatewayVo {
                id: 1u64.into(),
                code: "svr01".to_string(),
                name: "主网关".to_string(),
                consul_key: "gatex/svr01.toml".to_string(),
                extra_toml: None,
                ops_json: None,
                static_json: None,
                upstream_error_json: None,
                remark: None,
                enabled: true,
                creater_id: 1u64.into(),
                create_ms: 0u64.into(),
                updater_id: 1u64.into(),
                update_ms: 0u64.into(),
            },
            listeners: vec![UiamGatewayListenerVo {
                id: 10u64.into(),
                gateway_id: 1u64.into(),
                kind: ListenerKind::Http,
                sort_no: 1,
                addrs_json: r#"[{"addr":"0.0.0.0:8080"}]"#.to_string(),
                remark: None,
                enabled: true,
                creater_id: 1u64.into(),
                create_ms: 0u64.into(),
                updater_id: 1u64.into(),
                update_ms: 0u64.into(),
            }],
            routes: vec![UiamGatewayRouteVo {
                id: 20u64.into(),
                listener_id: 10u64.into(),
                sort_no: 1,
                name: "adm 后台接口".to_string(),
                matcher_json: r#"{"type":"Prefix","urn":["/adm"]}"#.to_string(),
                to_json: r#"{"type":"LoadBalancer","name":"adm-lb"}"#.to_string(),
                log_json: None,
                enabled: true,
                creater_id: 1u64.into(),
                create_ms: 0u64.into(),
                updater_id: 1u64.into(),
                update_ms: 0u64.into(),
            }],
            balancers: vec![UiamGatewayBalancerVo {
                id: 30u64.into(),
                gateway_id: 1u64.into(),
                name: "adm-lb".to_string(),
                config_json: r#"{"type":"Array","backends":["127.0.0.1:9001"]}"#.to_string(),
                remark: None,
                enabled: true,
                creater_id: 1u64.into(),
                create_ms: 0u64.into(),
                updater_id: 1u64.into(),
                update_ms: 0u64.into(),
            }],
        }
    }

    #[test]
    fn 最小配置能渲染且能装起来() {
        let rendered = render(&sample_input(), None).expect("应当渲染成功");

        assert!(rendered.toml.contains("[[listeners]]"), "{}", rendered.toml);
        assert!(rendered.toml.contains("/adm"), "{}", rendered.toml);
        assert_eq!(rendered.report.http_listeners, 1);
        assert_eq!(rendered.report.routes, 1);
        assert_eq!(rendered.report.balancers, 1);
        assert_eq!(rendered.checksum.len(), 64);
        assert!(rendered.structural_change.is_none(), "首版不做结构比对");
    }

    #[test]
    fn 同一份数据渲染两次字节流一致() {
        let first = render(&sample_input(), None).expect("第一次");
        let second = render(&sample_input(), None).expect("第二次");

        assert_eq!(first.toml, second.toml, "顺序必须确定，否则 checksum 不稳定");
        assert_eq!(first.checksum, second.checksum);
    }

    #[test]
    fn 有没有_extra_toml_不影响键序() {
        // 早期实现在「没有 extra_toml」时直接返回结构化序列化的原文，
        // 导致同一份配置因为多了一段高级配置就整体换了键序、checksum 随之变化。
        // 这里锁住：两种情况下结构化段的相对顺序必须一致。
        let plain = render(&sample_input(), None).expect("无高级配置");
        let mut with_extra = sample_input();
        with_extra.gateway.extra_toml = Some("[pingora-conf]\nthreads = 2\n".to_string());
        let extra = render(&with_extra, None).expect("有高级配置");

        let keys = |text: &str| -> Vec<String> {
            text.lines()
                .filter(|line| line.starts_with('['))
                .map(|line| line.to_string())
                .collect()
        };
        let plain_keys = keys(&plain.toml);
        let extra_keys = keys(&extra.toml);
        assert_eq!(
            plain_keys,
            extra_keys[..plain_keys.len()].to_vec(),
            "结构化段的键序必须与有没有 extra_toml 无关"
        );
    }

    #[test]
    fn extra_toml_能补_pingora_conf() {
        let mut input = sample_input();
        input.gateway.extra_toml = Some("[pingora-conf]\nthreads = 8\n".to_string());

        let rendered = render(&input, None).expect("应当渲染成功");
        assert!(rendered.toml.contains("threads = 8"), "{}", rendered.toml);
        assert_eq!(rendered.app_config.pingora_conf.0.threads, 8);
    }

    #[test]
    fn extra_toml_不能覆盖结构化段() {
        let mut input = sample_input();
        input.gateway.extra_toml = Some("listeners = []\n".to_string());

        let rendered = render(&input, None).expect("应当渲染成功");
        assert_eq!(
            rendered.app_config.listeners.len(),
            1,
            "结构化段必须来自数据库"
        );
        assert!(
            rendered.warnings.iter().any(|w| w.contains("listeners")),
            "被忽略的键要提示: {:?}",
            rendered.warnings
        );
    }

    #[test]
    fn extra_toml_语法错误被拒绝() {
        let mut input = sample_input();
        input.gateway.extra_toml = Some("[pingora-conf\nthreads = 8".to_string());

        let err = render(&input, None).expect_err("语法错误必须拒绝");
        assert!(
            matches!(err, RenderError::ExtraToml { .. }),
            "应归到 extra_toml 错误: {err:?}"
        );
    }

    #[test]
    fn 引用不存在的负载均衡器被拒绝() {
        let mut input = sample_input();
        input.routes[0].to_json = r#"{"type":"LoadBalancer","name":"not-exist"}"#.to_string();

        let err = render(&input, None).expect_err("必须拒绝");
        assert!(
            matches!(err, RenderError::Validate(ref reason) if reason.contains("not-exist")),
            "错误要指出是哪个 LB: {err:?}"
        );
    }

    #[test]
    fn 停用的路由不参与渲染且给出提示() {
        let mut input = sample_input();
        input.routes[0].enabled = false;

        let rendered = render(&input, None).expect("应当渲染成功");
        assert_eq!(rendered.app_config.listeners[0].routes.len(), 0);
        assert!(
            rendered.warnings.iter().any(|w| w.contains("已停用")),
            "要提示有记录被跳过: {:?}",
            rendered.warnings
        );
    }

    #[test]
    fn 改监听地址被判为结构性变更() {
        let previous = render(&sample_input(), None).expect("首版");

        let mut next = sample_input();
        next.listeners[0].addrs_json = r#"[{"addr":"0.0.0.0:9090"}]"#.to_string();
        let rendered = render(
            &next,
            Some(&PreviousRelease {
                id: 1u64.into(),
                content: previous.toml.clone(),
            }),
        )
        .expect("第二版");

        let reason = rendered
            .structural_change
            .expect("改监听地址必须要求重启");
        assert!(reason.contains("addrs"), "原因要点明字段: {reason}");
    }

    #[test]
    fn 只改路由不算结构性变更() {
        let previous = render(&sample_input(), None).expect("首版");

        let mut next = sample_input();
        next.routes[0].matcher_json = r#"{"type":"Prefix","urn":["/api"]}"#.to_string();
        let rendered = render(
            &next,
            Some(&PreviousRelease {
                id: 1u64.into(),
                content: previous.toml.clone(),
            }),
        )
        .expect("第二版");

        assert!(rendered.structural_change.is_none(), "改路由应当可热更新");
    }

    #[test]
    fn tcp_路由上的_http_匹配器会告警而不是静默降级() {
        // 前端复用同一套路由表单，用户在 TCP 路由上填 Regex 是常见误操作。
        // 早期实现直接取 Default，界面上看着配了、实际没生效。
        let mut input = sample_input();
        input.listeners[0].kind = ListenerKind::Tcp;
        input.routes[0].matcher_json = r#"{"type":"Regex","regex":"([a-z"}"#.to_string();
        input.routes[0].to_json = r#"{"type":"Host","addr":"10.0.0.5:6379"}"#.to_string();
        input.balancers.clear();

        let rendered = render(&input, None).expect("降级后仍应可渲染");
        assert!(
            rendered
                .warnings
                .iter()
                .any(|w| w.contains("在 TCP 监听器上无效")),
            "必须提示匹配器被忽略: {:?}",
            rendered.warnings
        );
    }

    #[test]
    fn tcp_监听器下多条_default_路由会告警() {
        let mut input = sample_input();
        input.listeners[0].kind = ListenerKind::Tcp;
        input.routes[0].matcher_json = r#"{"type":"Default"}"#.to_string();
        input.routes[0].to_json = r#"{"type":"Host","addr":"10.0.0.5:6379"}"#.to_string();
        let mut second = input.routes[0].clone();
        second.id = 21u64.into();
        second.name = "第二条".to_string();
        input.routes.push(second);
        input.balancers.clear();

        let rendered = render(&input, None).expect("应当渲染成功");
        assert!(
            rendered
                .warnings
                .iter()
                .any(|w| w.contains("只有第一条会生效")),
            "要提示后者不生效: {:?}",
            rendered.warnings
        );
    }

    #[test]
    fn tcp_监听器渲染到_tcp_listeners() {
        let mut input = sample_input();
        input.listeners[0].kind = ListenerKind::Tcp;
        input.routes[0].matcher_json = r#"{"type":"Default"}"#.to_string();
        input.routes[0].to_json = r#"{"type":"Host","addr":"10.0.0.5:6379"}"#.to_string();
        input.balancers.clear();

        let rendered = render(&input, None).expect("应当渲染成功");
        assert_eq!(rendered.app_config.listeners.len(), 0);
        assert_eq!(rendered.app_config.tcp_listeners.len(), 1);
        assert_eq!(rendered.app_config.tcp_listeners[0].routes.len(), 1);
    }
}

