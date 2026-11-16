//! # 用户偏好服务
//!
//! 桌面布局、组件外观、站点配置、小组件中心位置都走这一份偏好：按
//! `(user_id, pref_key)` 一行，值为 JSON 文本。读写都是整份快照，前端本地优先、
//! 后台防抖同步，所以这里不需要增量协议。
//!
//! ## 为什么 key 要白名单
//!
//! 这张表是通用的 text 存储，不能变成任意键值垃圾桶：只接受前端模块真正使用的
//! 四个键，写错一个字符就 400，避免出现「写进去了但永远没人读」的脏数据。

use crate::dao::UiamUserPrefDao;
use crate::mo::uiam_user_pref::{ActiveModel, Column, Entity};
use robotech::dao::DaoError;
use robotech::db::get_db_conn;
use robotech::svc::SvcError;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set,
    TransactionTrait,
};
use serde_json::Value;
use std::borrow::Cow;
use std::collections::BTreeMap;
use tracing::warn;
use uiam_api::dto::UiamPrefMap;

/// 前端 `PREF_KEYS` 的镜像；两边必须同步
const ALLOWED_KEYS: &[&str] = &[
    "uiam-desktop",
    "uiam-widget-appearance",
    "uiam-site",
    "uiam-gallery",
];

/// 单个偏好值上限：桌面布局是几百字节，64KB 足够，避免一次 PUT 塞满 TEXT
const MAX_VALUE_BYTES: usize = 64 * 1024;
/// 一份快照总上限
const MAX_TOTAL_BYTES: usize = 256 * 1024;

/// # 读取用户偏好
///
/// 只返回能解析成 JSON 的行；坏数据跳过并记一条 warn，不让一行脏数据把整个
/// 桌面布局打成 500。
pub async fn load_prefs(user_id: u64) -> Result<UiamPrefMap, SvcError> {
    let db = get_db_conn()?;
    load_prefs_with_db(db.as_ref(), user_id).await
}

/// # 读取用户偏好（指定连接）
pub async fn load_prefs_with_db<C>(db: &C, user_id: u64) -> Result<UiamPrefMap, SvcError>
where
    C: ConnectionTrait + Sync,
{
    let rows = Entity::find()
        .filter(Column::UserId.eq(to_i64(user_id)?))
        .all(db)
        .await
        .map_err(db_err)?;

    let mut prefs = BTreeMap::new();
    for row in rows {
        match serde_json::from_str::<Value>(&row.pref_value) {
            Ok(value) => {
                prefs.insert(row.pref_key, value);
            }
            Err(err) => warn!(
                user_id,
                pref_key = %row.pref_key,
                "偏好值不是合法 JSON，已跳过：{err}"
            ),
        }
    }
    Ok(UiamPrefMap { prefs })
}

/// # 保存用户偏好（整份快照）
///
/// `null` 表示删除该键（回到默认）；其余值原样序列化。事务内逐键 upsert，
/// 中途失败不会留下半份快照。
pub async fn save_prefs(
    user_id: u64,
    operator_id: u64,
    map: UiamPrefMap,
) -> Result<UiamPrefMap, SvcError> {
    let user_id_i64 = to_i64(user_id)?;
    let operator_id_i64 = to_i64(operator_id)?;
    let now = wheel_rs::time_utils::now_ms() as i64;

    validate(&map)?;

    let db = get_db_conn()?;
    let tx = db.begin().await.map_err(db_err)?;

    for (key, value) in &map.prefs {
        let existing = Entity::find()
            .filter(Column::UserId.eq(user_id_i64))
            .filter(Column::PrefKey.eq(key.clone()))
            .one(&tx)
            .await
            .map_err(db_err)?;

        if value.is_null() {
            if let Some(row) = existing {
                Entity::delete_by_id(row.id).exec(&tx).await.map_err(db_err)?;
            }
            continue;
        }

        let text = serde_json::to_string(value)
            .map_err(|err| SvcError::Runtime(anyhow::anyhow!("偏好值序列化失败：{err}")))?;

        match existing {
            Some(row) => {
                let mut active: ActiveModel = row.into();
                active.pref_value = Set(text);
                active.updater_id = Set(operator_id_i64);
                active.update_ms = Set(now);
                active.update(&tx).await.map_err(db_err)?;
            }
            None => {
                UiamUserPrefDao::insert(
                    ActiveModel {
                        user_id: Set(user_id_i64),
                        pref_key: Set(key.clone()),
                        pref_value: Set(text),
                        creater_id: Set(operator_id_i64),
                        updater_id: Set(operator_id_i64),
                        ..Default::default()
                    },
                    &tx,
                )
                .await
                .map_err(SvcError::from)?;
            }
        }
    }

    tx.commit().await.map_err(db_err)?;
    load_prefs(user_id).await
}

fn validate(map: &UiamPrefMap) -> Result<(), SvcError> {
    let mut total = 0usize;
    for (key, value) in &map.prefs {
        if !ALLOWED_KEYS.contains(&key.as_str()) {
            return Err(invalid(
                "pref_key",
                format!("未知的偏好键 `{key}`；只允许 {}", ALLOWED_KEYS.join(" / ")),
            ));
        }
        let size = serde_json::to_vec(value)
            .map_err(|err| SvcError::Runtime(anyhow::anyhow!("偏好值序列化失败：{err}")))?
            .len();
        if size > MAX_VALUE_BYTES {
            return Err(invalid(
                "pref_value",
                format!("偏好 `{key}` 超过 {}KB", MAX_VALUE_BYTES / 1024),
            ));
        }
        total += size;
    }
    if total > MAX_TOTAL_BYTES {
        return Err(invalid(
            "pref_value",
            format!("偏好快照超过 {}KB", MAX_TOTAL_BYTES / 1024),
        ));
    }
    Ok(())
}

fn to_i64(id: u64) -> Result<i64, SvcError> {
    i64::try_from(id).map_err(|_| {
        SvcError::Validation(
            validator::ValidationError::new("id").with_message(Cow::Borrowed("ID 超出范围")),
        )
    })
}

fn invalid(code: &'static str, message: String) -> SvcError {
    SvcError::Validation(validator::ValidationError::new(code).with_message(Cow::Owned(message)))
}

fn db_err(err: sea_orm::DbErr) -> SvcError {
    SvcError::from(DaoError::parse_db_err(err))
}
