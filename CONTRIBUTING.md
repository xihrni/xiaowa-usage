# 贡献指南

感谢你愿意帮助小哇变得更好。这个项目是社区工具，欢迎兼容性反馈、界面改进、文档修正和代码贡献。

## 开始之前

- 使用 Windows 10/11 x64 开发和验证；
- 安装 Node.js 22 或更高版本；
- 已安装并登录 WorkBuddy，至少创建过一次会话；
- 不要在 Issue、截图或提交中附带真实会话标题、数据库、访问令牌或个人信息。

## 开发环境

```bash
git clone https://github.com/xihrni/xiaowa-usage.git
cd xiaowa-usage
npm ci
npm start
```

检查本地数据读取：

```bash
npm run check
```

基础语法检查：

```bash
node --check src/main.js
node --check src/preload.js
node --check src/renderer.js
```

## 分支与提交

- `main` 始终保持可运行；
- 功能分支使用 `feat/简短说明`；
- 修复分支使用 `fix/简短说明`；
- 文档分支使用 `docs/简短说明`；
- 提交信息建议使用 `feat:`、`fix:`、`docs:`、`chore:` 前缀；
- 一个提交尽量只做一件事。

## 提交前检查

1. 应用能够通过 `npm start` 正常启动；
2. 不包含 `node_modules`、构建产物、真实数据库或截图；
3. 新增本地数据读取时，必须处理文件不存在、被占用和结构变化；
4. 不引入上传会话内容的网络请求；
5. 涉及界面的改动附上脱敏截图；
6. 涉及 Windows 打包的改动说明是否验证过安装、升级和卸载。

## 数据与隐私

- 只读取当前用户的 WorkBuddy 本地数据；
- 新增依赖前说明用途，不允许静默遥测；
- 错误日志不得输出会话完整内容；
- 调试截图必须使用虚构数据或彻底脱敏；
- 发现安全问题请遵循 [SECURITY.md](SECURITY.md)，不要公开利用细节。

## Pull Request

PR 描述请说明：

- 改动目的；
- 影响范围；
- 验证方式；
- 是否存在兼容性或隐私影响；
- 相关 Issue 编号。

界面改动建议附“修改前 / 修改后”截图。维护者可能会要求缩小范围或补充兼容性验证。

## Issue

- Bug 请使用 Bug Report 模板；
- 功能建议请使用 Feature Request 模板；
- 不提供真实数据库或完整会话 JSONL；
- 先搜索已有 Issue，避免重复。

## 许可证

提交代码即表示同意以项目的 [MIT License](LICENSE) 授权。角色美术素材不适用 MIT License。
