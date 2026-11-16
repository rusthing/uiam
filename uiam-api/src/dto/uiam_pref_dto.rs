//! # 用户偏好 DTO
//!
//! 一次读写一整份偏好快照：`prefs` 的 key 是前端约定的偏好键，value 是任意
//! JSON。`null` 表示删除该键（回到默认），不存在与 `null` 语义一致。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use utoipa::ToSchema;

/// # 用户偏好快照
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UiamPrefMap {
    /// 偏好键 → JSON 值；`null` 表示删除该键
    #[schema(value_type = Object)]
    pub prefs: BTreeMap<String, Value>,
}
