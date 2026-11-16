//! `SeaORM` Entity for 用户偏好

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize, Default)]
#[sea_orm(table_name = "uiam_user_pref")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, unique)]
    pub id: i64,
    pub user_id: i64,
    /// 偏好键，如 uiam-desktop / uiam-widget-appearance / uiam-site / uiam-gallery
    pub pref_key: String,
    /// JSON 文本，结构由对应模块自行解释
    pub pref_value: String,
    pub creater_id: i64,
    pub create_ms: i64,
    pub updater_id: i64,
    pub update_ms: i64,
}

impl ActiveModelBehavior for ActiveModel {}
