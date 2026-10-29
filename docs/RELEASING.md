# 发布流程

## 1. 确定版本

修改 `package.json` 的 `version`，例如 `0.2.0`。

使用仓库自带的 NSIS 脚本本地打包时，还要同步修改 `installer/WorkBuddyPet.nsi`：

```nsis
!define APP_VERSION "0.2.0"
!define APP_VERSION4 "0.2.0.0"
```

更新 `CHANGELOG.md`，写清楚新增功能、修复和已知问题。

## 2. 本地验证

```bash
npm ci
npm run check
node --check src/main.js
node --check src/preload.js
node --check src/renderer.js
npm start
```

涉及打包时：

```bash
npm run dist
```

确认：

- 安装包与便携包可启动；
- 设置页版本号正确；
- 安装、升级、卸载正常；
- 自动更新元数据已生成；
- 未配置证书时明确标记为未签名版本。

## 3. 提交版本

```bash
git add package.json package-lock.json CHANGELOG.md installer/WorkBuddyPet.nsi
git commit -m "chore: release v0.2.0"
git push origin main
```

## 4. 打标签并发布

标签必须与 `package.json` 版本完全一致：

```bash
git tag -a v0.2.0 -m "Xiaowa 0.2.0"
git push origin v0.2.0
```

GitHub Actions 会：

1. 校验标签与 `package.json` 版本一致；
2. 构建 NSIS 安装包；
3. 可选使用代码签名证书；
4. 生成便携 ZIP；
5. 生成更新元数据和校验文件；
6. 创建或更新 GitHub Release；
7. 上传构建产物。

工作流文件：`.github/workflows/release.yml`

## 5. Release 必传文件

自动更新依赖以下文件，不能手工删减：

- `WorkBuddyPet-Setup-X.Y.Z.exe`
- `WorkBuddyPet-X.Y.Z-win-x64.zip`
- `WorkBuddyPet-Setup-X.Y.Z.exe.blockmap`
- `latest.yml`
- `SHA256SUMS.txt`

`latest.yml` 中包含版本、安装包文件名、SHA-512 和发布日期。客户端的 `electron-updater` 会读取它判断是否有新版本。

## 6. 验证自动更新

准备两个版本：

1. 安装旧版本，例如 `0.1.0`；
2. 发布新版本，例如 `0.2.0`；
3. 打开设置页，点击“检查更新”；
4. 确认出现新版本说明；
5. 点击“下载更新”，确认进度正常；
6. 点击“重启并安装”；
7. 重新打开后确认版本号已变成 `0.2.0`，设置和本地数据仍保留。

不要用相同版本号重复发布来测试更新，客户端只会认为当前已经是最新。

## 7. 发布失败或回滚

- 不要删除已下载量较大的 Release 文件；
- 不要发布比当前版本号更低的“回滚版本”，自动更新不会降级；
- 发布更高版本修复问题；
- 只有在安装包完全无法使用时，才考虑撤回 Release，并同时发布说明；
- 更新 `latest.yml` 时必须保持文件名和 SHA-512 与安装包一致。

## 8. 代码签名

签名证书配置见 [CODE_SIGNING.md](CODE_SIGNING.md)。

未配置证书时，构建仍然成功，但 Windows 可能显示“未知发布者”。Release Notes 中应明确提示。

## 9. 发布后检查

- Release 页面显示正确的 Latest 标识；
- 下载链接返回安装包；
- `SHA256SUMS.txt` 与实际文件匹配；
- 自动更新能检测到新版本；
- 下载页仍指向最新版本；
- 仓库 Homepage 可访问。
