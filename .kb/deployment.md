# 部署与运行

> 最后更新：2026-07-20

当前仓库具备源码方式运行和本地自动测试，但没有托管 CI、生产打包、代码签名、公证或自动更新配置。

## 本地安装

```bash
cd sign-compose-app
npm ci
```

依赖由 `package-lock.json` 锁定。`sharp` 和 Electron 包含平台相关二进制，复制整个 `node_modules` 到不同平台或架构不是可靠的安装方式，应在目标机器重新执行 `npm ci`。

> ⏳ 待补充：在 `package.json` 中声明经验证的 Node.js 与 npm 版本。

## 启动

命令行：

```bash
cd sign-compose-app
npm start
```

`npm start` 实际执行：

```bash
ELECTRON_RUN_AS_NODE= electron .
```

macOS 可双击 workspace 根目录的 `启动签名合成App.command`，脚本会进入 `sign-compose-app/` 后运行 `npm start`。

## 运行时资产

- 主入口：`sign-compose-app/src/main/index.js`
- 渲染入口：`sign-compose-app/src/renderer/index.html`
- Preload：`sign-compose-app/src/preload.js`
- 本地用户数据：`app.getPath('userData')/userData/users/`
- 用户选择的 xlsx 与导出文件不属于应用安装目录。

## 当前发布缺口

仓库中未发现以下配置：

- electron-builder、Electron Forge 或其他打包器；
- macOS Developer ID 签名、公证和 entitlements；
- DMG/ZIP/PKG 产物配置；
- 自动更新服务；
- 生产版本发布说明。

托管 CI 待 GitHub CLI 凭据具备 `workflow` 权限后接入；发布前目前需本地执行 `npm ci`、`npm test` 和 `npm audit --omit=dev`。

> ⏳ 待补充：产品负责人提供目标发布渠道与最低 macOS 版本，开发者据此建立构建、签名、公证和回滚流程。

## 发布前最低检查

在正式打包流程建立后，至少应执行：

```bash
cd sign-compose-app
npm ci
npm test
```

`npm test` 会在操作系统临时目录生成全合成 xlsx 和图片，不依赖或读取真实业务样例。还需人工检查注册/登录、图片框选、签名调整、Excel/WPS 打开导出文件，以及应用数据目录的升级兼容性。

发布源码前还应确认根目录 `.gitignore` 生效，并再次扫描密钥、账号、绝对路径、真实姓名/组织名称、签名图片和业务表格。
