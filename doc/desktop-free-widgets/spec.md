# uiam 桌面 widget 自由摆放 — 规格

## 1. 现状与问题

项目：`/Users/zbz/workspace/rusthing/uiam`（独立仓库，与 `adm-rs` 无关）。

现状（`uiam-web/src/shell/Desktop.tsx`、`useWidgetLayout.ts`）：

- `LayoutState` 有 `free` 开关，默认 `false`，走 CSS Grid `grid-auto-flow: row dense`，所以卡片从左到右自动铺满。
- 只有设置页打开「自由摆放」后，才写入 `x/y` 网格坐标；而且 pointer 拖动被 `if (!shell.editing || !free) return` 拦住，必须先点「编辑桌面」。
- 结果：用户看到的仍是自动铺满，无法随手拖动。

目标：像 macOS 桌面 widget 一样——**不用进编辑态，直接拖，放到哪就停在哪**；位置按用户存到 uiam-svr。

## 2. 范围

只改 uiam：

- `uiam-web`：布局数据、拖动交互、设置页文案、样式。
- `uiam-svr` / `uiam-api`：新增按用户保存偏好的表与 GET/PUT 接口。
- 不改 `adm-rs`、不改 `syn`。

## 3. 交互规格

1. 自由摆放成为**唯一**桌面布局：所有 widget 始终带网格坐标 `x/y`，不再自动流式铺满。
2. 直接拖拽：在卡片任意非交互区域按下即可拖（按钮、链接、输入框、尺寸手柄、移除按钮除外），**不要求编辑态**。
3. 点击与拖动区分：移动距离 < 4px 视为点击（打开对应应用）；≥ 4px 进入拖拽，松手后抑制这一次 click，避免「拖完弹窗」。
4. 拖拽用 pointer capture；拖动中卡片 `z-index` 抬高、`cursor: grabbing`、透明度 0.85、带阴影。
5. 吸附：按网格单元吸附（沿用 `--wg-unit` + `--wg-gap`），x 限制在 `0 .. columns - w`，y 下限 0。
6. 不允许重叠：落点被占用时，从落点向外按曼哈顿距离找最近的空位；找不到才允许叠放。
7. 添加组件（小组件中心拖入）同样按落点找最近空位放入；尺寸变更后若与其它组件重叠，自动挪到最近空位。
8. 编辑态保留，但只负责「改尺寸 / 移除 / 打开小组件中心 / 恢复默认布局」，不再是拖拽前置条件。
9. 窄屏仍按当前列数收敛：`columns = floor((容器宽 + gap) / (unit + gap))`，已有坐标按列数裁剪显示，不改写存储值。
10. 「恢复默认布局」回到内置默认排布（重新计算坐标，不重叠）。

## 4. 数据模型（前端）

`uiam-web/src/shell/useWidgetLayout.ts`：

```ts
interface LayoutItem { id: WidgetId; size: WidgetSize; x: number; y: number }
interface LayoutState { version: 3; items: LayoutItem[] }
```

- 删除 `free`、`setFree`、`reorder`、`AddAt.beforeId`。
- 新增并导出：
  - `packItems(items, columns): LayoutItem[]`：first-fit 货架排布，按 `SIZE_FAMILY` 的 `w/h` 占位，用于默认布局与新增组件。
  - `nearestFree(occupied, w, h, x, y, columns)`：从落点向外找最近空位。
- `add(id, size, at?, columns)`：有落点用落点，否则 `packItems` 末尾放入。
- `move(id, x, y, columns)`：吸附并做重叠避让。
- `setSize` / `cycleSize`：改完尺寸若重叠，移到最近空位。
- `reset`：`DEFAULT_ITEMS`（默认顺序不变，坐标由 4 列 first-fit 生成）。
- 迁移（`normalizeState`）：
  - v3：校验并去重；缺 `x/y` 的按默认顺序补齐坐标。
  - v2：保留已有 `x/y`；原本 `free:false` 的按数组顺序 first-fit 生成坐标，顺序不丢。
  - v1（纯数组）：先按旧规则映射尺寸，再 first-fit 生成坐标。
  - 非法/空数据：回落 `DEFAULT_ITEMS`。
- 持久化：沿用 `writePref('uiam-desktop', state)`，位置一变即写本地并触发远端防抖同步。

## 5. 前端改动清单

### 5.1 `src/shell/Desktop.tsx`

- 去掉 `free`/`setFree`/`reorder` 与 `uiam-set-free` 事件监听。
- 删除 HTML5 排序拖拽（`onDragStart/onDragOver/onDragEnd/onDrop`、`dragId`）；小组件中心的 HTML5 拖入保留。
- `onWidgetPointerDown`：移除 `!shell.editing || !free` 判断，记录起点与阈值状态。
- `onWidgetPointerMove`：超过 4px 才开始更新预览坐标，调用 `move` 时带 `metrics.columns`。
- `onWidgetPointerUp`：真正发生过移动才落库并置 `suppressClick`（0ms 后复位）。
- `onActivate`：`suppressClick` 为真时不打开应用。
- 每个 widget 始终输出 `--col`/`--row`，`className` 不再拼 `free`。
- 小组件中心 drop：`add(id, size, { x, y }, metrics.columns)`。

### 5.2 `src/shell/useWidgetLayout.ts`

按第 4 节改造。

### 5.3 `src/apps/SettingsApp.tsx`

- 删除「自由摆放」开关与 `uiam-set-free` 派发。
- 文案改为：直接拖动组件摆放，自动吸附网格；编辑态用于改尺寸/移除。

### 5.4 `src/index.css`

- `.widgets` 改为 `grid-auto-flow: row`，删除 `.widgets.free` 相关规则。
- `.widget` 基础样式增加：
  ```css
  grid-column: var(--col, 1) / span var(--w, 1);
  grid-row: var(--row, 1) / span var(--h, 1);
  ```
- `.widget.dragging` 改为 `opacity: .85; z-index: 20; cursor: grabbing;`，并补 `will-change: transform`。
- 保留 `.widgets.editing .widget` 的编辑态描边与 `cursor: grab`。

### 5.5 `src/lib/preferences.ts`

- `REMOTE_URL` 默认指向 uiam-svr：`(import.meta.env.VITE_PREFERENCES_URL ?? `${API_BASE}/uiam/preferences`)`，仍允许环境变量覆盖；去掉空值时自动回退。
- GET/PUT 契约保持「扁平对象 key→JSON」；PUT 失败仍静默（本地优先）。
- `preferencesBackend()` 在默认可用时显示 `uiam-svr /uiam/preferences`。

## 6. 后端设计（uiam-svr / uiam-api）

### 6.1 表 `uiam_user_pref`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INT8 PK | DAO 宏生成 |
| user_id | INT8 not null | 用户 ID（`X-User-Id`） |
| pref_key | VARCHAR(64) not null | 偏好键 |
| pref_value | TEXT not null | JSON 文本 |
| creater_id / create_ms / updater_id / update_ms | INT8 not null | 审计字段 |

约束与索引：

- 唯一约束 `AK_USER_KEY_UIAM_USER_PREF`：`(user_id, pref_key)`。
- 普通索引 `idx_uiam_user_pref_user`：`(user_id)`。

落地：

- `uiam-svr/migrations/pgsql/20261114000000_create-table.sql`：追加建表与列注释，头部表清单改为 6 张。
- `uiam-svr/migrations/pgsql/20261114000001_create-index.sql`：追加索引。

### 6.2 实体与 DAO

- 新增 `uiam-api/src/mo/uiam_user_pref.rs`：
  ```rust
  #[sea_orm::model]
  #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize, Default)]
  #[sea_orm(table_name = "uiam_user_pref")]
  pub struct Model { id, user_id, pref_key, pref_value, creater_id, create_ms, updater_id, update_ms }
  ```
- `uiam-api/src/mo/mod.rs`、`prelude.rs` 注册。
- 新增 `uiam-svr/src/dao/uiam_user_pref_dao.rs`：
  ```rust
  #[dao(unique_keys: [("user_id,pref_key", "用户偏好键")])]
  pub struct UiamUserPrefDao;
  ```
- `uiam-svr/src/dao/mod.rs` 注册。

### 6.3 契约

`uiam-api/src/dto/uiam_pref_dto.rs`：

```rust
#[derive(Serialize, Deserialize, ToSchema)]
#[serde(transparent)]
pub struct UiamPrefMap(pub BTreeMap<String, Value>);
```

`uiam-api/src/dto/mod.rs` 注册。

### 6.4 接口

- `GET /uiam/preferences`
  - Header：`X-User-Id` 必需。
  - 返回 `Ro<UiamPrefMap>`：`{ "uiam-desktop": {...}, ... }`；没有记录返回 `{}`。
- `PUT /uiam/preferences`
  - Header：`X-User-Id` 必需。
  - Body：`UiamPrefMap`（扁平对象）。
  - 允许的 key 白名单：`uiam-desktop`、`uiam-widget-appearance`、`uiam-site`、`uiam-gallery`；其它 key 返回 400 并指出 key 名。
  - `null` 值表示删除该 key（回到默认）；其余值序列化为 JSON 文本。
  - 单值上限 64KB，总上限 256KB，超限 400。
  - 事务内逐 key upsert/delete，返回保存后的完整快照。
- 保存时 `creater_id/updater_id` 取 `X-User-Id`，时间取 `wheel_rs::time_utils::now_ms()`。

### 6.5 文件

- 新增 `uiam-svr/src/svc/uiam_pref_svc.rs`：`load_prefs(user_id)`、`save_prefs(user_id, operator_id, map)`；`uiam-svr/src/svc/mod.rs` 注册。
- 新增 `uiam-svr/src/web/ctrl/uiam_pref_ctrl.rs`：`get_prefs_handler`、`save_prefs_handler`；用 `get_current_user_id`、`#[debug_handler]`、`#[log_call]`、`#[utoipa::path]`；`uiam-svr/src/web/ctrl/mod.rs` 注册。
- 新增 `uiam-svr/src/web/router/uiam_pref_router.rs`：
  ```rust
  #[router(routes [
      ("/uiam/preferences", get(get_prefs_handler)),
      ("/uiam/preferences", put(save_prefs_handler))
  ])]
  struct UiamPrefRouter;
  ```
  `uiam-svr/src/web/router/mod.rs` 注册。
- 新增 `uiam-svr/src/web/api_doc/uiam_pref_api_doc.rs`：`#[api_doc(get_prefs_handler, save_prefs_handler)]`；`uiam-svr/src/web/api_doc/mod.rs` 注册。

## 7. 兼容与降级

- 远端偏好接口不可达：读写都退回 localStorage，桌面不被网络卡住，不弹错。
- 旧 v1/v2 布局：迁移为 v3 坐标，顺序与已有位置尽量保留。
- 未登录/无 `X-User-Id`：沿用现有接口约定返回 400；前端已固定带 header。
- 卡片删除/重新添加：坐标重新按空位放置，不残留重叠。

## 8. 验收标准

1. 打开桌面即可直接拖动任意卡片，松手停在网格位置，不再自动从左铺满。
2. 拖动后刷新页面位置不变；换浏览器/换设备同一 `X-User-Id` 位置一致。
3. 未进入编辑态即可拖动；拖动结束不会误打开应用；单击仍能打开应用。
4. 编辑态仍可改尺寸、移除、恢复默认布局。
5. 卡片不会互相重叠；被占用落点会就近挪到空位。
6. 小组件中心拖入、改尺寸后仍然不重叠。
7. 断开 uiam-svr 时前端仍能拖动并保存到本地，无报错弹窗。

## 9. 验证步骤

```bash
# 前端
pnpm --dir /Users/zbz/workspace/rusthing/uiam/uiam-web typecheck
pnpm --dir /Users/zbz/workspace/rusthing/uiam/uiam-web build

# 后端
cargo check -p uiam-api -p uiam-svr   # 在 /Users/zbz/workspace/rusthing/uiam 下
cargo test -p uiam-svr

# 手工
pnpm --dir /Users/zbz/workspace/rusthing/uiam/uiam-web dev
# 1) 直接拖 3 张卡片 → 刷新 → 位置保持
# 2) 查看 Network：PUT /uiam/preferences 400ms 防抖，body 含 uiam-desktop
# 3) 改尺寸/移除/恢复默认布局
# 4) 缩窄窗口，卡片按列收敛且不重叠
```

## 10. 明确不做

- 不做任意像素级定位（macOS 也是网格吸附）。
- 不做触摸长按拖拽（鼠标/触控板为主）。
- 不改网关配置业务接口。
- 不改 `adm-rs`、`syn`。
