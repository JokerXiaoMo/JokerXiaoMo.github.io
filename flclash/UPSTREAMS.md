# 山海行上游参考核验记录

> 核验日期：2026-08-13（GMT+8）。本文为项目说明撰写的事实记录，不构成法律意见。

| 项目 | 山海行中的关系 | 核验到的公开定位 | 许可证/注意事项 |
|---|---|---|---|
| [chen08209/FlClash](https://github.com/chen08209/FlClash) | 宿主客户端；山海行以其 JavaScript 覆写入口运行 | 跨平台 ClashMeta/Mihomo 代理客户端 | GPL-3.0。山海行不包含或复制 FlClash 源码。 |
| [blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script) | 运行时远程引用 AdvertisingLite、ChinaMax、Global 三份 Classical 规则 | 分流规则、重写规则及脚本仓库 | GPL-2.0。上游 README 另含资源转载限制；山海行不打包这些规则文件，只在运行时引用其公开地址。 |
| [IvanSolis1989/Smart-Config-Kit](https://github.com/IvanSolis1989/Smart-Config-Kit) | 架构参考：动态节点分类、区域 url-test 组、业务策略组与规则提供者分层 | 面向多客户端的分流配置与覆写脚本项目 | GitHub API 未显示许可证信息；山海行仅参考功能组织方式，不复制其脚本或规则清单。 |
| [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo) | FlClash 所用 Mihomo 配置语义的上游背景 | 本文仅作为配置兼容性背景提及 | 不作为山海行代码或规则的直接来源。 |

## 归因边界

山海行的原创文件位于 `flclash/` 目录：`ShanHaiXing.js`、测试夹具和项目说明。项目内不包含上述上游项目的源代码，也不重新分发 `blackmatrix7/ios_rule_script` 的规则内容。规则文件会由 FlClash/Mihomo 根据脚本中的 URL 在用户设备运行时获取。

## 素材边界

`flclash/assets/` 中的插画由仓库维护者提供，仅作为项目展示素材。它们不随山海行源代码的开源许可授权；公开仓库维护者应确保自己拥有上传、展示和再分发这些素材的必要权利。
