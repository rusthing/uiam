//! # 用户偏好路由
//!
//! 两条，都在 `/uiam/preferences`：
//! - `GET` 读取当前用户整份偏好
//! - `PUT` 写入整份偏快照

#![allow(unused_imports)]

use robotech::macros::router;

#[router(routes [
    ("/uiam/preferences", get(get_prefs_handler).put(save_prefs_handler))
])]
struct UiamPrefRouter;
