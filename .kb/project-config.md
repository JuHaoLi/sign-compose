# 项目配置

> 最后更新：2026-07-20

## npm 元数据

| 项 | 值 |
|---|---|
| 包名 | `sign-compose-app` |
| 版本 | `1.0.0` |
| 主入口 | `src/main/index.js` |
| 许可证字段 | `ISC` |
| lockfile | npm lockfile v3 |

`description`、`keywords` 和 `author` 当前为空。

`jszip` 作为直接依赖，用于在 ExcelJS 解析前检查 xlsx 压缩包条目数和声明解压体积。

## 依赖覆盖

`overrides.uuid` 为 `^11.1.1`，用于替换 ExcelJS 间接依赖中的旧版本。该覆盖已通过完整 xlsx 自测；发布前依赖审计为 0 个已知漏洞。

## npm scripts

| 命令 | 实际脚本 | 状态 |
|---|---|---|
| `npm start` | `ELECTRON_RUN_AS_NODE= electron .` | 可启动应用 |
| `npm test` | `node test/selftest.js` | 生成全合成样例并执行完整自测 |

完整自测：

```bash
npm test
```

## 环境变量

应用源码没有读取业务环境变量。唯一相关项是 start script 将 `ELECTRON_RUN_AS_NODE` 设为空值，以避免 Electron 被外部环境强制按 Node 模式运行。

没有发现 `.env`、`.env.example` 或配置加载库。

## Electron 配置

| 配置 | 值 |
|---|---|
| 窗口尺寸 | 1280 × 840 |
| 标题 | 人工签名合成 |
| contextIsolation | `true` |
| nodeIntegration | `false` |
| sandbox | `true` |
| preload | `src/preload.js` |
| 渲染文件 | `src/renderer/index.html` |

非 macOS 平台关闭所有窗口时调用 `app.quit()`；macOS 保持应用生命周期，并在 activate 时重建窗口。

## HTML 安全策略

`src/renderer/index.html` 使用：

```text
default-src 'self'; script-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'
```

UI 需要 data URL 展示本地图片，并大量使用内联 style，因此当前允许 `data:` 图片和内联样式。脚本只允许自身资源。
窗口拒绝新窗口和外部导航；来自签名库与工作簿的动态 HTML 文本会先转义。

## 运行时常量

| 文件 | 常量 | 值 |
|---|---|---:|
| `src/main/image.js` | `TARGET_HEIGHT` | 200 |
| `src/main/image.js` | `OVERLAP_RATIO` | 0.10 |
| `src/main/image.js` | `BIN_THRESHOLD` | 180 |
| `src/main/image.js` | `DILATE_PASSES` | 1 |
| `src/main/xlsx.js` | `FILL_RATIO` | 0.96 |
| `src/main/xlsx.js` | `EMU` | 9525 |
| `src/main/file-limits.js` | `MAX_IMAGE_BYTES` | 25 MiB |
| `src/main/file-limits.js` | `MAX_IMAGE_PIXELS` | 80000000 |
| `src/main/file-limits.js` | `MAX_XLSX_BYTES` | 50 MiB |
| `src/main/file-limits.js` | `MAX_XLSX_UNCOMPRESSED_BYTES` | 250 MiB |

这些值目前硬编码，没有 UI 或外部配置入口。修改它们会改变图像/布局结果，必须同步运行完整自测。

## 数据与测试样例

- 应用数据：`app.getPath('userData')/userData/`。
- 默认自测样例：由 `test/selftest.js` 在操作系统临时目录动态生成，内容全部为虚构数据。
- 可选地向自测脚本传入自有 xlsx 路径做兼容测试；项目约束要求不得覆盖源文件。
- 应用没有初始测试凭据，首次使用必须自行注册。

> ⏳ 待补充：声明 Node/npm/macOS 支持版本。
