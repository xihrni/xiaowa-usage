# 安全说明

## 支持范围

安全修复优先覆盖最新发布版本。较旧版本可能不再单独维护。

## 报告安全问题

如果发现以下问题，请不要直接公开利用细节：

- 读取了预期范围之外的文件；
- 泄露本地会话标题、积分或 Token 数据；
- 安装包或构建产物被篡改；
- 远程代码执行、权限提升或路径穿越；
- 依赖中的已知高危漏洞。

建议通过 GitHub 仓库的 **Security → Report a vulnerability** 私下报告。如果仓库尚未开启私密报告，可以先创建 Issue，只说明“存在安全问题，希望私下联系”，不要附带利用代码或真实数据。

报告时请提供：

- 受影响的版本；
- Windows 版本；
- 复现步骤；
- 影响范围；
- 是否涉及真实数据。

## 请勿提交的内容

公开 Issue、讨论和 Pull Request 中不要包含：

- `workbuddy.db` 或会话 JSONL；
- API Key、访问令牌和账号凭据；
- 公司名称、客户信息或未公开项目内容；
- 可被利用的完整攻击代码。

## 发布文件校验

每个 Release 附带 `SHA256SUMS.txt`。下载后可校验：

```powershell
Get-FileHash .\WorkBuddyPet-Setup-0.1.0.exe -Algorithm SHA256
```

将结果与 `SHA256SUMS.txt` 中的值进行比对。
