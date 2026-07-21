# 人工签名合成 App · 迭代 2 施工细则（签名库检索 + 工作区最大还原/就地编辑）

> 本文件是第 2 次迭代的施工细则，**在 `plan.md` 之上补充**。`plan.md` 的
> 8 条红线与 13 项验收标准继续全部生效；本次仅在其框架内做增强，不改需求定稿范围。

## 0. 本次目标（已与用户对齐）

**签名库模块**
- 排版改为「表格列表视图」，每条一行。
- 新增检索：搜索框 + 排序 + 过滤；新增 4 个利于检索的下级列：拼音、来源词、入库时间、笔迹张数/多图标记。

**工作区模块**
- ①「最大还原」：导入表格尽量贴近原表——列宽、行高、合并单元格、水平/垂直对齐、字号、字体族、加粗、字体颜色、单元格填充色、边框，并显示原表已有的嵌入图片；配缩放控件。
- ②「就地编辑的所见即所得」：取消独立预览页。选中单元格→合成→格内文字就地换成签名图，整表实时呈现；合成后可继续编辑文字、继续合成新签名、调整已放签名（拖拽手柄缩放 + 右键菜单换图/重生成/删除/对齐）。

## 1. 本次新增/细化的约束（红线补充）

- **R11 补充（宽高比）**：*自动*充满单元格时宽高比锁定、签名不得变形（守原红线 11）；仅当用户*手动*拖拽手柄缩放时允许自由拉伸（视为人工主动选择）。系统导入/自动放置一律不变形。
- **依赖**：新增 `pinyin-pro`（纯 JS、离线），不违反红线 2（红线 2 仅禁 Python），无网络请求。
- **原文件保护不变**：导出仍为另存 `原名_已合成.xlsx`，原文件只读（红线 3/8）。
- **exceljs 保真已验证**：样例表往返测试通过（图片/合并/填充色不丢），本迭代继续用 exceljs 路线；XML 改写为未启用的备选预案。

## 2. 签名库模块设计

### 2.1 数据格式变更（`library.js`）
- 每个条目新增 `createdAt`（ISO 时间字符串），仅对**今后入库**的条目写入；存量老条目无此字段，前端显示「—」。
- 拼音**不入库**，由汉字实时计算（`pinyin-pro`），全拼 + 首字母，检索时用。

### 2.2 主进程（`index.js` / `library.js`）
- `addSignature` / `addCharImage`：写入 `createdAt`。
- `lib:list` 返回的每个条目补充：`pinyin`（全拼，空格分隔）、`initial`（首字母串）、`createdAt`、缩略图 `dataUrl`；组级返回 `count`（张数）。拼音在主进程用 `pinyin-pro` 计算。

### 2.3 界面（`renderer/views/library.js`）
- 上半部分「录入签名 / 补录单字」保持不变。
- 「字体库」区重做为**表格列表视图**：
  - 顶部工具栏：搜索框、排序下拉（拼音 / 入库时间 / 张数）、单字/整词切换、过滤（全部 / 仅多图 / 仅单图）。
  - 表头列：缩略图 | 字·词 | 拼音 | 来源词 | 张数 | 入库时间 | 操作（设默认/删除；多图时逐行）。
  - 搜索匹配：字/词文本、拼音全拼、拼音首字母、来源词，任一命中即显示。
  - 保留原能力：设默认、删单张、补单字。

## 3. 工作区模块设计

### 3.1 主进程 `xlsx.js`：富样式网格提取（最大还原）
`grid()` 扩展返回：
- `rows[r][c]` = { text, style }，style 含 font{name,size,bold,color}、fill(bg #RRGGBB)、align{h,v}、border（四边 style+color）。ARGB→CSS 转换，主题色缺省兜底。
- `colWidthsPx[]`、`rowHeightsPx[]`（Excel 单位→px，复用现有换算）。
- `merges`（现有）+ 每个合并区解析为 {top,left,bottom,right}。
- `images[]`：原表已有嵌入图片，用 `ws.getImages()` + `wb.getImage()`，锚点 tl/br（分数列行 + EMU 偏移）换算成 excel-px 的 {x,y,w,h}，附 `dataUrl`（display-only 还原）。

### 3.2 签名项几何模型（通用化，支持自由拉伸）
每个已放签名项 item：
- `row,col,word,mode,missing,variantIndex,variantCount`
- `png`（Buffer）、`imgW,imgH`（intrinsic）
- `region`：所在单元格/合并区在 excel-px 的 {x,y,w,h}
- `box`：签名在区域内的 {offX,offY,dispW,dispH}（excel-px，相对 region 左上角）
  - 自动放置：宽高比锁定，等比充满区域（留 4% 安全边）→ 计算初始 box。
  - 手动拖拽：renderer 直接改写 box（可非等比），回传主进程。
- 导出用 box 直接换算 twoCellAnchor（复用 `_walkCol/_walkRow` + EMU）。

### 3.3 IPC 面（替换原 preview/updateItem/export）
- `xlsx:open` → 富网格（3.1）。
- `xlsx:setCell`（不变）。
- `xlsx:compose(targets)` → 逐格合成，主进程按 key `"r,c"` 存 item，返回展示用列表（dataUrl + region + box + intrinsic + mode/missing/variant）。
- `xlsx:updateSignature({row,col, box?, action?})`：
  - `box`：手动缩放/移动覆盖（自由拉伸允许）。
  - `action:'cycleVariant'|'regenerate'`：换图/重生成 → 重算 png + **自动 box（宽高比锁定，丢弃手动覆盖）**。
  - `action:'align', alignH/alignV`：在 region 内按对齐重排 box（保持当前 dispW/dispH）。
  - 返回刷新后的 item。
- `xlsx:deleteSignature({row,col})`：从主进程状态移除该 item（workbook 文字始终未动，删除即恢复文字可编辑，无需还原）。
- `xlsx:export`：清空已签名格文字→按各 item 的 box 插图→另存 `原名_已合成.xlsx`（不覆盖原文件）；原表已有图片由 exceljs 保留。返回结果（含缺字清单）。

> 编辑期主进程 workbook 文字**保持不动**，签名只在渲染层覆盖显示；只有导出 `writeItems` 时才 `value=null` 并插图。因此「删除签名恢复文字」零成本。

### 3.4 界面 `renderer/views/workspace.js`：所见即所得表格
- **渲染富表格**：`<colgroup>` 定列宽、行设行高；合并区用 rowspan/colspan（被覆盖格跳过）；逐格套 font/color/bg/align/border 内联样式；格 `contentEditable` 可改文字，blur→`setCell`。
- **缩放**：外层 `transform: scale(z); transform-origin: top left`，滑块调 z；几何内部用 excel-px（1:1），缩放纯视觉；鼠标增量除以 z 换回 excel-px。
- **叠加层**（absolute，覆盖在表格上，同一 excel-px 坐标系）：
  - 原表已有图片：display-only。
  - 已放签名：每个可**点选**（显示四角手柄）、**拖拽移动**（限制在 region 内）、**拖角缩放**（自由拉伸）、**右键菜单**（换一张字图 / 重新生成 / 删除签名 / 对齐 子项）。
    - 拖拽/菜单动作 → 调 `xlsx:updateSignature` / `deleteSignature`，本地即时刷新。
- **合成入口**：选中若干格（点选高亮）→「合成签名」按钮 → `xlsx:compose` → 叠加层加入签名、对应格视觉隐藏文字。
- **改回文字**：已签名格需先右键「删除签名」，该格才恢复可编辑文字（守用户约定，防误改）。
- **缺字**：缺字位系统字体混排、该格标红、结果区列出缺哪个字（守验收 6）。
- **导出**：「全部确认，导出」→ `xlsx:export`，另存新文件。

## 4. 实施步骤（按序）

1. 依赖：装 `pinyin-pro`。
2. 签名库后端：`library.js` 加 `createdAt`；`index.js` `lib:list` 补拼音/时间/张数。
3. 签名库界面：表格列表 + 搜索/排序/过滤。
4. 工作区后端：`xlsx.js` 富网格提取 + 图片提取 + item/几何模型 + compose/update/delete/export 重构。
5. 工作区界面：富表格渲染 + 缩放 + 叠加层（手柄/拖拽/右键）+ 就地合成/删除/改字。
6. 自测：扩 `selftest.js` 覆盖富网格提取、图片提取、item box 模型、往返保留原图、update/delete；**先跑通再联调界面**。
7. 验收：过 `plan.md` 第 3 节 + 本次新增点（检索、最大还原、就地编辑、自由拉伸不变形约束）。

## 5. 本次验收补充点

| # | 验收项 | 通过标准 |
|---|---|---|
| A | 签名库检索 | 搜索框输入 字/拼音/首字母/来源词 任一可过滤；可按 拼音/时间/张数 排序；仅多图/仅单图过滤生效 |
| B | 下级列 | 列表显示 拼音、来源词、张数、入库时间；新入库条目有时间，老条目显「—」 |
| C | 最大还原 | 样例表导入后：列宽/行高/合并/对齐/字号/字体色/填充色/边框贴近原表；原有图片可见 |
| D | 就地合成 | 选中格合成后格内文字就地变签名图，整表实时呈现；可继续改其他格、再合成新格 |
| E | 签名调整 | 点选签名出手柄；拖角缩放、拖体移动、右键换图/重生成/删除/对齐均生效 |
| F | 变形约束 | 自动放置签名不变形（宽高比锁定）；手动拖角可自由拉伸 |
| G | 删除恢复 | 右键删除签名后该格恢复可编辑文字 |
| H | 导出保真 | 导出文件含合成签名 + 原表已有图片；原文件字节不变 |
