use serde::Deserialize;
use utoipa::ToSchema;

/// # 发布请求
///
/// 两个开关都是「明确表态」用的，默认全 `false`——即：内容没变就不推、
/// 需要重启就不发。要突破这两条必须显式传参，不能靠前端「顺手带上」。
#[derive(Debug, Clone, Default, Deserialize, ToSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct UiamGatewayPublishDto {
    /// 内容与当前线上版本一致时也强制推送
    ///
    /// 默认 `false`：`checksum` 和最新一版已推送的记录相同就跳过，不产生新版本。
    /// 打开它的唯一理由是「KV 被人手工改过，我要按库里的配置重新盖回去」。
    pub force: bool,

    /// 已确认「本次发布会重启网关」
    ///
    /// 渲染结果与上一版存在结构性差异（监听地址、监听器增减、`pingora-conf` 等
    /// 只能在启动时生效的配置）时，不带这个标记会被拒绝——先预览、看明白
    /// 为什么要重启，再回来点确认。
    pub confirm_restart: bool,
}

/// # 回滚请求
///
/// 回滚是把某条历史版本的 `content` **原样**再推一次，不重新渲染。
#[derive(Debug, Clone, Default, Deserialize, ToSchema)]
#[serde(default, rename_all = "camelCase")]
pub struct UiamGatewayRollbackDto {
    /// 已确认「本次回滚会重启网关」
    ///
    /// 回滚版本与当前线上版本的监听配置不同时同样需要确认。判断不出来
    /// （历史内容读不懂）时不拦，只在结果里给告警——紧急回滚不该被卡住。
    pub confirm_restart: bool,
}
