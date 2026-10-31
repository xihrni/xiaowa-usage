# WorkBuddy 小哇助手 v0.4.1

本版将下载与自动更新源切换到阿里云深圳 OSS，主要解决国内访问 GitHub Release 超时、下载失败的问题。

## 下载与更新

- 安装包、便携 ZIP、`latest.yml`、blockmap、校验文件默认托管在阿里云 OSS；
- 下载页默认使用国内 OSS 下载；
- GitHub Release 保留为官方备用入口；
- 后续版本自动更新从 OSS 读取。

## 升级说明

`v0.4.0` 的自动更新地址仍然是 GitHub，因此国内用户需要：

1. 从下载页手动安装一次 `v0.4.1` 国内 OSS 版本；
2. 之后的新版本会自动走 OSS 更新。

## 下载

- 国内 OSS：<https://xiaowa-xihrni-com.oss-cn-shenzhen.aliyuncs.com/stable/>
- GitHub Releases：<https://github.com/xihrni/xiaowa-usage/releases/tag/v0.4.1>

## 已知限制

- 仅支持 Windows 10/11 x64；
- 当前构建尚未配置商业代码签名证书，Windows 可能显示“未知发布者”。
