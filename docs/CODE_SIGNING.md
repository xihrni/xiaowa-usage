# Windows 代码签名

代码签名用于向 Windows 证明安装包和主程序的发布者身份，并减少 SmartScreen 的未知发布者提示。

## 当前状态

仓库已支持在 GitHub Actions 中读取签名证书并验证签名，但**证书需要单独购买和配置**，不能通过代码生成可信签名。

没有配置证书时，Actions 仍会生成可用但未签名的安装包。

## 需要的证书

优先选择受 Windows 信任的代码签名证书：

- OV Code Signing；
- EV Code Signing；
- 支持导出 PFX 的证书最适合当前流程；
- 基于硬件令牌或云 HSM 的证书需要额外的签名服务或自托管 Runner，不能直接作为 `CSC_LINK` 使用。

自签名证书不能减少 SmartScreen 警告，不建议用于公开 Release。

## 配置 GitHub Secrets

在仓库的 **Settings → Secrets and variables → Actions** 添加：

| Secret | 内容 |
|---|---|
| `WINDOWS_CSC_LINK` | PFX 文件的 Base64 文本，或可访问 PFX 的 HTTPS URL |
| `WINDOWS_CSC_KEY_PASSWORD` | PFX 导出密码 |

本地将 PFX 转为 Base64：

```powershell
[Convert]::ToBase64String(
  [IO.File]::ReadAllBytes("C:\secure\codesign.pfx")
) | Set-Clipboard
```

不要把 PFX、密码或 Base64 内容提交到仓库、Issue 或聊天记录。

使用 GitHub CLI 配置：

```powershell
$base64 = [Convert]::ToBase64String(
  [IO.File]::ReadAllBytes("C:\secure\codesign.pfx")
)
$base64 | gh secret set WINDOWS_CSC_LINK
gh secret set WINDOWS_CSC_KEY_PASSWORD
```

写入后清空终端历史，并确认 PFX 文件没有位于仓库目录内。

## 构建时如何使用

`.github/workflows/release.yml` 已把以下环境变量传给 `electron-builder`：

```text
CSC_LINK
CSC_KEY_PASSWORD
```

存在证书时，`electron-builder` 会签主程序和 NSIS 安装包。随后工作流执行：

```powershell
Get-AuthenticodeSignature .\release-builder\WorkBuddyPet-Setup-*.exe
```

只有状态为 `Valid` 才继续上传 Release。

## 本地签名

设置环境变量后运行：

```powershell
$env:CSC_LINK = "C:\secure\codesign.pfx"
$env:CSC_KEY_PASSWORD = "证书密码"
npm run dist
```

验证：

```powershell
Get-AuthenticodeSignature .\release-builder\WorkBuddyPet-Setup-0.1.0.exe |
  Format-List Status, StatusMessage, SignerCertificate
```

## SmartScreen 说明

代码签名是必要条件，但不等于立刻消除所有提示：

- OV 证书需要逐步积累下载信誉；
- EV 证书通常有更好的初始信誉；
- 新证书、下载量很低或文件被大量举报时，仍可能触发提示；
- 不要通过修改文件名或重复上传规避信誉系统。

## 证书轮换

证书到期或更换后：

1. 更新两个 GitHub Secrets；
2. 保持 `appId` 和安装目录不变，避免升级链路断裂；
3. 发布一个正常递增版本，验证旧版本可以通过自动更新升级；
4. 不要在证书失效后继续发布同版本号。

## 尚未完成的部分

本仓库当前没有可用的商业代码签名证书，因此发布包仍是未签名状态。配置上述 Secrets 后即可自动启用签名，无需修改代码。
