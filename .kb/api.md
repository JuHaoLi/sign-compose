# Electron IPC 接口

> 最后更新：2026-07-20

本项目没有 HTTP API。渲染进程通过 `src/preload.js` 暴露的 `window.api` 调用主进程，共注册 17 个 `ipcMain.handle`。调用均返回 Promise；主进程抛出的错误会传回渲染进程。

## 用户接口

| 渲染调用 | IPC channel | 输入 | 返回/效果 |
|---|---|---|---|
| `users.login(payload)` | `users:login` | `{ account, password }` | `{ profile, stats }`，并进入该用户签名库 |
| `users.register(payload)` | `users:register` | `{ account, name, password }` | 创建用户后返回 `{ profile, stats }` |
| `users.logout()` | `users:logout` | 无 | 清空当前用户、签名库和已打开文档 |
| `users.current()` | `users:current` | 无 | `{ profile, stats }`；未登录时 profile 为 `null` |

公开 profile 不包含 `salt` 与 `passwordHash`。账号查找大小写不敏感；重复账号、空账号、少于 8 个字符或多于 128 个字符的密码，以及错误密码都会被拒绝。

## 签名导入与图库接口

| 渲染调用 | IPC channel | 输入 | 返回/效果 |
|---|---|---|---|
| `lib.analyze(word)` | `import:analyze` | 签名对应词 | 打开图片选择框；返回词语、尺寸与 data URL，取消时返回 `null` |
| `lib.confirm(payload)` | `import:confirm` | `{ word, boxes[] }` | 消费主进程最近批准的图片，裁出逐字图与整词图并入库，返回统计和预览 |
| `lib.stats()` | `lib:stats` | 无 | `{ charCount, wordCount, chars, words }` |
| `lib.list()` | `lib:list` | 无 | 单字/整词分组、拼音、首字母、条目数和图片 data URL |
| `lib.deleteEntry(payload)` | `lib:deleteEntry` | `{ type, key, id }` | 删除索引条目和对应 PNG，返回新统计 |
| `lib.setDefault(payload)` | `lib:setDefault` | `{ type, key, id }` | 设置指定单字或整词的默认图片 |
| `lib.addChar(ch)` | `lib:addChar` | 单个汉字 | 选择图片、二值化并入库；取消时返回 `null` |

`type` 在图库接口中使用 `char` 或 `word`。`import:confirm` 要求框数量与词的 Unicode 字符数相等，并且词语、用户会话与最近一次 `import:analyze` 完全匹配；批准结果只能消费一次。可选输入图片扩展名：PNG、JPG/JPEG、WebP、BMP。

## xlsx 工作区接口

| 渲染调用 | IPC channel | 输入 | 返回/效果 |
|---|---|---|---|
| `xlsx.open()` | `xlsx:open` | 无 | 选择 `.xlsx`，返回首个 worksheet 的富网格；取消为 `null` |
| `xlsx.setCell(payload)` | `xlsx:setCell` | `{ row, col, value }` | 修改内存 workbook 中的单元格值 |
| `xlsx.compose(targets)` | `xlsx:compose` | `[{ row, col }, ...]` | 合成并缓存签名项，返回图片、模式、缺字和布局信息 |
| `xlsx.updateSignature(payload)` | `xlsx:updateSignature` | `{ row, col, box? }` 或带 `action` | 移动/缩放、换图、重生成或对齐，返回更新后的签名项 |
| `xlsx.deleteSignature(payload)` | `xlsx:deleteSignature` | `{ row, col }` | 删除内存中的待导出签名，原文字仍可编辑 |
| `xlsx.export()` | `xlsx:export` | 无 | 选择另存路径，写入签名并返回 `{ outPath, results }` |

`xlsx:updateSignature` 的动作：

- `action: "cycleVariant"`：循环使用下一张备选图，并恢复自动等比布局。
- `action: "regenerate"`：按当前词重新生成，并恢复自动等比布局。
- `action: "align"`：结合 `alignH`（left/center/right）或 `alignV`（top/middle/bottom）重新对齐。
- `box`：覆盖 `{ offX, offY, dispW, dispH }`；主进程会把结果限制在目标单元格或合并区内。

## 状态前置条件

- 图库接口和 `xlsx.open()` 要求已经登录，否则抛出“请先选择用户”。
- 除 `xlsx.open()` 外的 xlsx 接口要求已经打开表格。
- 导出要求至少有一个待导出签名。
- 导出路径与源文件相同时会被明确拒绝。
- 图片、xlsx 与异步文件操作受大小、解压范围和用户会话代际限制；切换账号后，在途操作会失效。

## 维护要求

新增或改名 IPC 时必须同步修改 `src/main/index.js` 与 `src/preload.js`，并更新本页。渲染进程不应直接获得 Node.js、文件系统或 Electron 主进程对象。
