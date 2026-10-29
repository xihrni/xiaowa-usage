# 自动更新说明

## 用户体验

小哇默认在启动 20 秒后静默检查一次更新，但**不会自动下载**。

设置页的“版本与更新”提供：

- 当前版本；
- 检查更新；
- 发现新版本后手动下载；
- 下载进度；
- 下载完成后重启并安装；
- 启动时自动检查开关。

更新失败不会影响主程序运行，只在设置页显示可读的错误信息。

## 技术实现

- 更新组件：`electron-updater`
- 发布源：GitHub Releases
- 仓库：`xihrni/xiaowa-usage`
- 更新文件：`latest.yml`
- 安装包：NSIS Setup EXE
- 差量文件：`*.exe.blockmap`

`electron-builder` 在构建时生成：

```text
latest.yml
WorkBuddyPet-Setup-X.Y.Z.exe
WorkBuddyPet-Setup-X.Y.Z.exe.blockmap
```

这三个文件必须与安装包一起上传到 Release。

## 更新流程

```text
启动 20 秒
  ↓
读取 latest.yml
  ↓
比较版本号
  ↓
发现新版本 → 设置页提示
  ↓
用户点击下载 → 下载安装包
  ↓
显示进度 → 用户点击重启安装
  ↓
NSIS 静默安装 → 重新启动新版本
```

## 安全边界

- 只接受 GitHub Release 中公开的更新信息；
- 不执行任意远程脚本；
- 更新包下载后由系统安装程序处理；
- 代码签名启用后，安装包签名校验由 Windows 完成；
- 不使用私有 Token，因此客户端不能读取私有仓库。

## 不支持的场景

- `npm start` 开发模式：显示“开发模式不检查更新”；
- 便携版在受限目录运行：NSIS 可能无法写入安装目录；
- GitHub API 被网络阻断：设置页提示检查失败，应用继续运行；
- 发布包没有 `latest.yml` 或版本号未递增：不会检测到更新。

## 测试更新

完整步骤见 [RELEASING.md](RELEASING.md) 的“验证自动更新”章节。

必须使用两个不同版本号。当前版本等于最新 Release 时，只会显示“已是最新版本”。

## 常见问题

### 检查更新失败

检查：

- 能否访问 `github.com` 和 `api.github.com`；
- Release 是否包含 `latest.yml`；
- `latest.yml` 中的安装包名称是否与实际附件一致；
- 当前版本是否低于 Release 版本。

### 下载完成但安装没有反应

- 确认使用安装版，而不是受限目录中的便携版；
- 检查 Windows 是否拦截了安装程序；
- 尝试关闭应用后手动运行下载目录中的安装包。

### 更新后设置丢失

设置保存在当前 Windows 用户的 `%APPDATA%` 应用数据目录。覆盖安装不应删除该目录。若设置丢失，请提交 Issue 并说明安装路径和版本。
