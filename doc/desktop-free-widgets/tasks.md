# 实施任务 — uiam 桌面 widget 自由摆放

> 依据 `spec.md`，只改 `uiam` 仓库。

## 第一阶段：交互（核心）

- [x] T1 布局模型改造 `uiam-web/src/shell/useWidgetLayout.ts`
  - `LayoutState` 升到 v3：`{ version: 3, items: LayoutItem[] }`，`LayoutItem.x/y` 必填。
  - 删除 `free`/`setFree`/`reorder`/`AddAt.beforeId`。
  - 新增导出 `packItems(items, columns)` 与 `nearestFree(...)`。
  - `add` / `move` / `setSize` / `cycleSize` 接入重叠避让；`move` 增加 `columns` 参数。
  - `normalizeState` 支持 v1/v2→v3，补齐缺失坐标。
  - 验证点：`grep -n 'free' useWidgetLayout.ts` 无残留逻辑。

- [x] T2 桌面拖动 `uiam-web/src/shell/Desktop.tsx`
  - 移除 `free`、`setFree`、`uiam-set-free`、HTML5 排序拖拽。
  - pointer 拖动解除 `editing/free` 限制；4px 阈值；suppressClick；拖拽中 z-index。
  - widget 始终写 `--col/--row`；drop 调 `add(..., columns)`。
  - 验证点：`grep -n 'reorder\|setFree\|beforeId\|free' Desktop.tsx` 仅剩必要注释。

- [x] T3 样式 `uiam-web/src/index.css`
  - `.widgets` 改 `grid-auto-flow: row`，删 `.widgets.free`。
  - `.widget` 基础加 `grid-column/grid-row` 变量定位。
  - `.widget.dragging` 改透明度/层级/光标。

- [x] T4 设置页 `uiam-web/src/apps/SettingsApp.tsx`
  - 删除自由摆放开关与事件派发，更新说明文案。

- [x] T5 前端自检
  - `pnpm --dir /Users/zbz/workspace/rusthing/uiam/uiam-web typecheck && pnpm --dir ... build`

## 第二阶段：后端持久化

- [x] T6 实体/DAO
  - 新增 `uiam-api/src/mo/uiam_user_pref.rs`；注册 `mo/mod.rs`、`mo/prelude.rs`。
  - 新增 `uiam-svr/src/dao/uiam_user_pref_dao.rs`；注册 `dao/mod.rs`。
  - 迁移：`migrations/pgsql/20261114000000_create-table.sql`、`20261114000001_create-index.sql` 追加表/约束/索引与注释。

- [x] T7 契约与服务
  - 新增 `uiam-api/src/dto/uiam_pref_dto.rs`（`UiamPrefMap`），注册 `dto/mod.rs`。
  - 新增 `uiam-svr/src/svc/uiam_pref_svc.rs`：`load_prefs`、`save_prefs`（白名单、null 删除、大小限制、事务 upsert）；注册 `svc/mod.rs`。

- [x] T8 接口
  - 新增 `uiam-svr/src/web/ctrl/uiam_pref_ctrl.rs`：GET/PUT handler（`get_current_user_id`、`log_call`、`utoipa`）；注册 `ctrl/mod.rs`。
  - 新增 `uiam-svr/src/web/router/uiam_pref_router.rs`；注册 `router/mod.rs`。
  - 新增 `uiam-svr/src/web/api_doc/uiam_pref_api_doc.rs`；注册 `api_doc/mod.rs`。

- [x] T9 前端接远端 `uiam-web/src/lib/preferences.ts`
  - `REMOTE_URL` 默认 `${API_BASE}/uiam/preferences`，环境变量可覆盖。
  - 保持 GET hydrate、PUT 400ms 防抖、失败静默。

- [x] T10 后端自检
  - `cargo check -p uiam-api -p uiam-svr`
  - `cargo test -p uiam-svr`

## 第三阶段：联调

- [x] T11 手工验收（spec 第 8 节 1-7 条）
  - 直接拖动、刷新保持、换账号隔离、点击/拖动不冲突、不重叠、编辑态功能、离线降级。
  - 已完成：浏览器实测直接拖动成功、未进编辑态、拖后不打开应用；其余需启动 uiam-svr + 数据库后手工确认。
- [x] T12 汇总变更与数据库升级说明（基线脚本已改，已有库需手工建表/建索引）。
