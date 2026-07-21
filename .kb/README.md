# 人工签名合成 App · 项目知识库

> 最后更新：2026-07-20

本知识库描述 workspace 根目录下的人工签名合成项目。应用源码位于 `sign-compose-app/`，形态为 macOS Electron 桌面应用：把手写签名照片整理为按用户隔离的单字/整词图库，再把 `.xlsx` 单元格中的姓名替换为签名图并另存新文件。

## 快速开始

```bash
cd sign-compose-app
npm ci
npm start
```

macOS 也可双击根目录的 `启动签名合成App.command`。应用不创建默认账号，首次使用需在登录页注册。

## 文档索引

| 文档 | 内容 | 状态 |
|---|---|---|
| [技术栈](tech-stack.md) | 运行架构、依赖版本与关键技术约束 | ✅ 已完成 |
| [IPC 接口](api.md) | 渲染进程可调用的 17 个 Electron IPC handler | ✅ 已完成 |
| [数据结构](database.md) | 本地文件存储、用户与签名库 JSON 结构 | ✅ 已完成 |
| [部署指南](deployment.md) | 本地安装与启动；生产打包仍待建设 | 🚧 部分完成 |
| [开发规范](dev-standards.md) | 目录职责、编码约定与安全边界 | 🚧 部分完成 |
| [业务逻辑](business-logic.md) | 用户、建库、合成、调整和导出流程 | ✅ 已完成 |
| [测试文档](testing.md) | 自测命令、覆盖范围和本次执行结果 | ✅ 已完成 |
| [项目配置](project-config.md) | npm 脚本、运行时常量和数据位置 | ✅ 已完成 |
| [常见问题](faq.md) | 启动、数据、缺字、导出等故障排查 | 🚧 部分完成 |
| [变更日志](changelog.md) | 知识库与项目版本记录 | 🚧 部分完成 |

## 代码地图

```text
.
├── README.md
├── .gitignore
├── sign-compose-app/
│   ├── package.json
│   ├── src/main/            # Electron 主进程、存储、图像与 xlsx
│   ├── src/preload.js       # contextBridge 白名单 API
│   ├── src/renderer/        # 原生 HTML/CSS/JS 界面
│   └── test/selftest.js     # 可执行自测
├── 启动签名合成App.command
├── plan.md
├── plan-迭代2.md
└── 项目功能总结.md
```

## 当前事实摘要

- 发布版本：`1.0.0.0`；npm 包版本：`1.0.0`。
- 数据全部写入 Electron `app.getPath('userData')/userData/users/`，未发现网络请求代码。
- 支持整词签名、单字拼接和缺字系统字体混排三种模式。
- 原始 xlsx 不允许被覆盖，默认输出名为 `原名_已合成.xlsx`。
- 签名资源使用随机 UUID 文件名，索引路径读取和删除均限制在当前账号目录内。
- 应用不提供固定默认账号或密码，首次使用必须自行注册。
- 2026-07-20 使用临时生成的全合成样例执行自测，70 项全部通过。
- `npm audit --omit=dev` 报告 0 个已知依赖漏洞；ExcelJS 的间接 uuid 依赖已覆盖到 11.1.1。
- 根目录 `.gitignore` 默认排除依赖、用户数据、密钥、日志和表格文件。
- workspace 已初始化 Git；70 项本地自动测试和生产依赖审计已通过，托管 CI 待接入。

## 待补充事项

> ⏳ 待补充：确定支持的 Node.js / macOS 最低版本。

> ⏳ 待补充：建立生产打包、签名、公证与发布流程。

> ⏳ 待补充：建立 lint/format 配置和二进制正式发布历史。
