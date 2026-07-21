# 开发规范

> 最后更新：2026-07-20

本文记录当前源码中能观察到的约定，以及项目计划明确写下的边界。仓库尚未配置自动 lint/format，因此这些约定目前主要靠评审和自测维持。

## 模块职责

| 路径 | 职责 |
|---|---|
| `src/main/index.js` | Electron 生命周期、窗口、会话状态与 IPC 编排 |
| `src/main/session-guard.js` | 用户会话代际与一次性导入授权 |
| `src/main/file-limits.js` | 图片、xlsx 压缩包与工作表资源边界 |
| `src/main/users.js` | 用户目录、账号、密码派生与登录 |
| `src/main/library.js` | `library.json` 和签名 PNG 的增删查改 |
| `src/main/image.js` | 与业务无关的图像处理函数 |
| `src/main/xlsx.js` | worksheet 网格、合并区、签名项几何和导出 |
| `src/preload.js` | 暴露最小化 `window.api` |
| `src/renderer/views/` | 登录、签名库、工作区三种 UI |
| `test/selftest.js` | 无测试框架的端到端模块自测 |

## 现有编码风格

- CommonJS：`require` / `module.exports`。
- JavaScript 文件使用 `'use strict';`。
- 两空格缩进、分号结尾、单引号字符串为主。
- 业务错误使用中文 `Error`，供 UI toast 直接展示。
- 主进程持有文件系统和 xlsx 状态；渲染进程不直接访问 Node.js。
- 坐标约定必须写清 0-based / 1-based；xlsx 公共调用使用 1-based 行列。
- 图像函数传递 `Buffer`，渲染预览通过 data URL。
- 未确认的兼容情况应安全降级，例如损坏用户目录被跳过、无法解析的 Excel 主题色回退默认样式。

## 必须保持的产品边界

- 不覆盖用户原始 xlsx；导出必须另存。
- 签名、照片与表格数据不上传网络，不引入遥测。
- 每个用户只访问自己的 `userData/users/<id>/`。
- 签名资源必须使用与用户输入无关的随机文件名；从索引解析出的路径必须验证仍位于当前账号目录。
- 入库图统一处理为白底黑字 PNG。
- 签名库保持“JSON 索引 + 普通 PNG 文件”，确保可复制备份。
- 自动放置保持宽高比；只有用户手动拖角时允许自由拉伸。
- 不引入 Python 运行时；项目当前所有处理位于 Node.js 生态。

## 修改检查表

- IPC 变更：同步主进程、preload、渲染调用与 [IPC 文档](api.md)。
- 数据结构变更：兼容旧 JSON，更新 [数据结构](database.md)，补迁移/回退测试。
- 图像算法变更：验证纯白背景、纯黑墨迹、裁边、拼接与缺字混排。
- xlsx 变更：用自测生成的全合成样例验证合并区、原有图片、样式、输出图与源文件哈希。
- 发布前检查：不得提交业务表格、签名原图、运行时用户目录、环境文件、密钥或私人绝对路径。
- 任何知识库更新：在 [变更日志](changelog.md) 的“未发布”段落记录。

## 当前工程缺口

> ⏳ 待补充：选择并配置 ESLint、Prettier/EditorConfig；目前未发现相关文件。

> ⏳ 待补充：确定长期分支、提交信息和 code review 规范。

> ⏳ 待补充：补充 Electron GUI 自动化测试。
