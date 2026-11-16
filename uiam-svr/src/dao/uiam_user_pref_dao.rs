use robotech::macros::dao;

/// # 用户偏好 DAO
///
/// ## 唯一约束
/// - `(user_id, pref_key)`：一个用户一个偏好键只有一行，写入走 upsert，
///   不在表里留重复快照。
#[dao(
    unique_keys: [
        ("user_id,pref_key", "用户偏好键"),
    ],
)]
pub struct UiamUserPrefDao;
