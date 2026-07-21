<div align="center">

# 人工签名合成

**把手写签名整理成可复用的本地图库，再安全地写回 Excel。**<br>
一个离线优先、按账号隔离、不覆盖原表的 macOS Electron 桌面工具。

![Electron](https://img.shields.io/badge/Electron-43-47848F?logo=electron&logoColor=white)
![Local only](https://img.shields.io/badge/data-local--only-2E7D32)
![Tests](https://img.shields.io/badge/self--test-70%20passed-2E7D32)
![License](https://img.shields.io/badge/license-ISC-blue)

</div>

---

## 这是什么

人工签名合成把“签名照片整理”和“Excel 签名落位”串成一条本地工作流：录入一张签名照片，逐字框选后生成整词与单字图库；打开 `.xlsx`，选择姓名所在单元格，即可预览、调整并另存带签名的新文件。

**适合**：内部表单签名整理、重复姓名签名复用、离线处理含敏感信息的工作簿。<br>
**不适合**：电子签章认证、身份核验、多人云协作、复杂 Excel 排版编辑或未经授权复制他人签名。

## ✨ 核心能力

| 能力 | 说明 |
|---|---|
| **签名建库** | 从 PNG、JPG、WebP 或 BMP 中逐字框选，生成白底黑字的整词图和单字图。 |
| **智能合成** | 优先使用整词签名；无整词时逐字拼接；缺字时用系统字体补位并明确提示。 |
| **可视化调整** | 在表格预览中移动、缩放、换图、重生成、对齐或删除签名。 |
| **Excel 保真** | 保留常见样式、合并单元格与已有嵌入图片，导出时不覆盖原文件。 |
| **本地隔离** | 不上传签名或表格；账号密码加盐派生，每个账号拥有独立签名目录。 |

## 🚀 快速开始

当前版本以源码方式运行，需要 macOS、Node.js 和 npm：

```bash
cd sign-compose-app
npm ci
npm start
```

也可以在 macOS 中双击根目录的 `启动签名合成App.command`。首次使用请选择“注册新账号”；项目不提供固定默认账号或默认密码。

## 使用流程

```text
注册 / 登录
    ↓
输入签名对应文字 → 选择照片 → 逐字框选 → 保存到个人签名库
    ↓
打开 xlsx → 选择目标单元格 → 合成签名 → 调整位置与尺寸
    ↓
另存为 *_已合成.xlsx（原文件保持不变）
```

合成策略只有一份明确的优先级：

1. 有完全匹配的整词图时，直接使用整词签名。
2. 没有整词图时，使用单字图库拼接。
3. 单字缺失时，使用系统字体临时补位，并在界面列出缺字。

## 🔒 安全与隐私

- 应用业务逻辑不包含网络上传、遥测或云端数据库；签名图、账号资料和表格都留在本机。
- 密码使用随机盐和 `scrypt` 派生保存，公开到界面的用户资料不包含盐或密码哈希。
- 签名资源使用随机 UUID 文件名，并对索引路径做账号目录边界校验，防止跨账号文件覆盖。
- BrowserWindow 启用上下文隔离并关闭 Node.js 集成；渲染进程只能调用 preload 中的白名单接口。
- 来自签名库和工作簿的动态文本会先做 HTML 转义，窗口也禁止跳转到外部页面。
- 导出路径若与源表相同会被拒绝，默认输出名为 `原名_已合成.xlsx`。
- `.gitignore` 默认排除本地用户数据、环境文件、日志、依赖目录和各类表格，降低误提交隐私数据的风险。

> [!IMPORTANT]
> 签名属于敏感个人数据。本项目不会替你完成授权、合规或法律效力判断；请只处理已获授权的签名与表格，并妥善保护操作系统账号和本地数据目录。当前本地签名 PNG 没有额外的应用层加密。

## 🧪 测试

```bash
cd sign-compose-app
npm test
```

测试会在操作系统临时目录生成完全虚构的账号、签名图和 `.xlsx`，覆盖用户隔离、会话失效、密码与文件边界、路径越界回归、HTML 注入转义、图像处理、签名库、表格保真、合成布局与导出。发布前复检结果为 **70 项通过**。

## 🏗 工作原理

```text
 Renderer                Electron Main                  本地文件
┌──────────┐   IPC    ┌──────────────────┐       ┌──────────────────┐
│ 登录/图库 │ ───────▶ │ UserStore        │ ─────▶ │ profile.json     │
│ 表格预览  │          │ LibraryStore     │ ─────▶ │ library.json/PNG │
│ 签名调整  │ ◀─────── │ sharp + ExcelJS  │ ─────▶ │ 新 xlsx          │
└──────────┘  preload  └──────────────────┘       └──────────────────┘
```

## 📁 项目结构

```text
.
├── README.md
├── .kb/                         # 项目知识库
├── sign-compose-app/
│   ├── src/main/                # Electron 主进程、用户、图库、图像与 xlsx
│   ├── src/renderer/            # 原生 HTML/CSS/JavaScript 界面
│   ├── src/preload.js           # 渲染进程白名单 API
│   └── test/selftest.js         # 自包含发布前自测
├── 启动签名合成App.command
└── 项目功能总结.md
```

## 当前边界

- 当前只读取工作簿的第一个 worksheet。
- 只支持 `.xlsx`，不支持旧 `.xls`、CSV 或加密工作簿。
- 已提供 70 项本地自动测试；托管 CI、安装包、macOS 代码签名、公证和自动更新仍待建设。
- ExcelJS 无法覆盖 Excel 的全部高级特性；复杂图表、条件格式或超大工作簿仍需人工验收。

更完整的接口、数据结构、测试与部署说明见 [项目知识库](.kb/README.md)。

## 项目文档

- [版本变更](CHANGELOG.md) · [后续工作](TODOS.md)
- [功能总结](项目功能总结.md)

## License

[ISC](LICENSE)

---

<div align="center">
<sub>Local-first · No default credentials · Original workbook preserved</sub>
</div>
