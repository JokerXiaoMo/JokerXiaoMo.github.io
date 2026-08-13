# 山海行 · 国风分流

![山海行主视觉：原创角色番小绯](./assets/shanhai-hero-red.png)

<sub>展示角色：**番小绯**。原创角色与插画由仓库维护者提供，并授权用于山海行项目展示。</sub>

> **让代理策略像山海长卷一样清晰。** 山海行是一份面向 FlClash 的 JavaScript 覆写脚本：它以国风动漫的可读命名呈现节点、服务与路由策略，同时保留明确、可验证的 Mihomo 分流逻辑。

| 项目 | 当前实现 |
|---|---|
| 宿主客户端 | FlClash 的 JavaScript 覆写功能 |
| 覆写入口 | `function main(config)` |
| 节点处理 | 动态分类香港/澳门、台湾、日本、新加坡、美国与其他节点 |
| 策略组布局 | `🌺 代理选择` 固定置顶，随后是区域测速组与业务策略组 |
| 远程规则 | AdvertisingLite、ChinaMax、Global 三份 Clash Classical 规则 |
| 测速方式 | `url-test`，每 600 秒复测，50 ms 容差，按需测速 |
| 适用场景 | 单订阅或已经聚合为 Mihomo 配置的订阅 |

## 为什么叫「山海行」

「山海」指向不同地域节点的选择与切换，「行」代表流量按照明确路线前进。国风名称只是界面表达，**每一个名称都对应可解释的技术功能**；脚本不会因为美化名称而隐藏实际路由语义。

![山海行角色展示：原创角色番小绯](./assets/shanhai-character-red.png)

<sub>番小绯 · 山海行展示插画</sub>

## 国风名称与实际功能对照

下面的表格是本项目最重要的阅读入口。导入后，在 FlClash 的「代理」页看到的每个名称都可以按此表理解。

| 策略组 | 实际功能 | 节点或服务范围 | 工作方式 |
|---|---|---|---|
| `🌺 代理选择` | 全局总开关，**始终显示在第一位** | 全部已生成区域组与 `DIRECT` | 手动选择；用于快速指定默认出口 |
| `☁️ 万象节点` | 全节点自动测速池 | 订阅内全部有效节点，过滤流量/到期等信息行 | `url-test` 自动择优 |
| `🏮 香江灯影` | 香港与澳门节点测速池 | `香港`、`澳门/澳門`、`Hong Kong`、`Macau/Macao`、`MO-01` 等带编号节点名 | `url-test` 自动择优；澳门节点并入此组 |
| `🪭 宝岛团扇` | 台湾节点测速池 | 台湾、台北、Taiwan、Taipei、TWN 等命名 | `url-test` 自动择优 |
| `🍑 东海桃影` | 日本节点测速池 | 日本、东京、大阪、Japan、Tokyo、Osaka、JPN 等命名 | `url-test` 自动择优 |
| `🪷 南洋莲舟` | 新加坡节点测速池 | 新加坡、Singapore、SG/SGP 等命名 | `url-test` 自动择优 |
| `⛵ 北美远航` | 美国节点测速池 | 美国、洛杉矶、西雅图、纽约、USA、US 等命名 | `url-test` 自动择优 |
| `⛰️ 四海云游` | 未识别地区节点池 | 不能被上述地区规则识别的有效节点 | `url-test` 自动择优 |
| `📜 灵枢智算` | AI 服务策略 | ChatGPT、OpenAI、Claude、Anthropic、Google Generative Language | 手动选择，优先提供美/新/日/全节点 |
| `🎭 梨园影音` | 海外视频服务策略 | YouTube、Google Video、Netflix、Netflix Video | 手动选择，优先提供港/台/日/美/新/全节点 |
| `🔭 云台观星` | Google 服务策略 | Google、Google APIs、GStatic | 手动选择，优先提供美/日/新/全节点 |
| `🧰 百工工坊` | 开发者服务策略 | GitHub、GitHub User Content、GitHub Assets、GitLab | 手动选择，优先提供美/日/新/全节点 |
| `🗺️ 山海行旅` | 通用海外服务策略 | Global 规则集中命中的常用海外站点 | 手动选择，默认按区域组选择 |
| `🧧 神州直连` | 中国大陆服务策略 | ChinaMax 规则、`GEOIP,CN` | 默认把直连放在候选首位 |
| `🌺 桃源归途` | 最终兜底策略 | 未被任何前置规则命中的流量 | 手动选择，默认按区域组选择 |
| `🛡️ 清风拂尘` | 广告拦截策略 | AdvertisingLite 规则集 | 默认 `REJECT`，可手动改为 `DIRECT` |

## 分流顺序：流量会去哪里

山海行将规则按优先级写入 `config.rules`。Mihomo 从上到下匹配，因此较具体的服务规则会先于通用规则和最终兜底生效。

| 优先级 | 规则类别 | 实际路由目标 |
|---|---|---|
| 1 | 局域网与本地域名/IP | `DIRECT` |
| 2 | AdvertisingLite | `🛡️ 清风拂尘` |
| 3 | OpenAI、ChatGPT、Claude、Anthropic、Google AI | `📜 灵枢智算` |
| 4 | YouTube 与 Netflix | `🎭 梨园影音` |
| 5 | Google 域名与 API | `🔭 云台观星` |
| 6 | GitHub、GitLab 等开发平台 | `🧰 百工工坊` |
| 7 | ChinaMax 与中国大陆 IP | `🧧 神州直连` |
| 8 | Global 规则集 | `🗺️ 山海行旅` |
| 9 | 未命中流量 | `🌺 桃源归途` |

## 节点测速与延迟表现

区域组采用 Mihomo 的 `url-test`。测试地址为 `https://www.gstatic.com/generate_204`，脚本设置 `interval: 600`、`tolerance: 50`、`lazy: true`。这意味着每个区域节点池会在实际需要时开始测试，并定期复测；延迟较优且可用的节点会成为自动选择的候选。

> **请区分“测速机制可用”与“你的节点延迟”。** 本仓库已验证测试地址可返回 HTTP 204，也对脚本的 `url-test` 参数、节点分类与策略生成进行了夹具测试。但真实延迟仍取决于订阅节点、当地网络、运营商和设备；请以 FlClash 代理页中实际显示的节点延迟为准。

## 一分钟导入

在 FlClash 中进入「配置 → 覆写脚本」，创建脚本后点击编辑器右上角的下载箭头，选择「导入 URL」，输入：

```text
https://raw.githubusercontent.com/JokerXiaoMo/JokerXiaoMo.github.io/main/flclash/ShanHaiXing.js
```

导入完成后，点击顶部的「未命名」并填写 `山海行`，再点击保存。返回订阅卡片的「更多 → 覆写」，关联山海行脚本并刷新订阅。之后进入「代理」页，确认第一项为 `🌺 代理选择`，并检查 `🏮 香江灯影` 是否包含你的香港和澳门节点。

## 快速验证

| 检查项 | 预期结果 |
|---|---|
| 覆写入口 | FlClash 成功保存并加载脚本，无 JavaScript 语法报错 |
| 首页策略组 | `🌺 代理选择` 位于第一项 |
| 澳门识别 | 名称包含 `澳门`、`Macau` 或 `MO-01` 的节点出现在 `🏮 香江灯影` |
| 规则提供者 | 出现 `shanhai-ad`、`shanhai-cn`、`shanhai-global` 三项 |
| AI 分流 | OpenAI/Claude 类服务命中 `📜 灵枢智算` |
| 视频分流 | YouTube/Netflix 命中 `🎭 梨园影音` |
| 延迟测试 | `🏮 香江灯影` 内可看到香港/澳门节点的实际延迟 |

## 架构参考与开源致谢

山海行并不是对某个上游项目的复制品。它以独立 JavaScript 编写策略组、节点识别和规则装配逻辑；下表说明实际参考关系，避免把“运行宿主”“规则来源”和“架构灵感”混为一谈。

| 开源项目 | 山海行如何使用或参考 | 归因边界 |
|---|---|---|
| [FlClash](https://github.com/chen08209/FlClash) | 作为跨平台 Mihomo 客户端与 JavaScript 覆写脚本的运行宿主 | 不包含、复制或修改 FlClash 源码；其仓库采用 GPL-3.0。[1] |
| [ios_rule_script](https://github.com/blackmatrix7/ios_rule_script) | 运行时从公开 URL 请求 AdvertisingLite、ChinaMax、Global 三份 Classical 规则 | 不打包、不再分发上游规则文件；使用前请阅读上游 GPL-2.0 许可及项目声明。[2] |
| [Smart-Config-Kit](https://github.com/IvanSolis1989/Smart-Config-Kit) | 参考“动态节点分类、区域测速组、业务策略组、规则提供者”的功能分层思路 | 未复制其代码或规则清单；GitHub 当前未显示许可证信息，故只作架构性致谢。[3] |
| [Mihomo](https://github.com/MetaCubeX/mihomo) | 为 `proxy-groups`、`url-test`、`rule-providers` 等配置语义提供内核背景 | 不作为山海行的代码或规则直接来源。[4] |

完整核验记录参见 [`UPSTREAMS.md`](./UPSTREAMS.md)。

## 开源许可与素材说明

> 我不是律师；以下为仓库的许可边界说明，不构成正式法律意见。公开发布或再分发前，如涉及商业用途、第三方规则或素材权利，请自行核验并在必要时咨询专业人士。

山海行的原创脚本、测试与文档使用 [MIT License](./LICENSE)。该许可**只覆盖 `flclash/` 目录中由本项目原创的文本与代码文件**，不授予第三方项目、远程规则文件或展示插画的任何权利。

两张展示插画中的角色为仓库维护者原创角色 **番小绯**，并由角色权利人授权用于山海行项目展示，文件位于 `assets/` 目录。插画**不随 MIT 许可授权**，也不因仓库公开而获得默认的商用、二次创作或再分发授权；如需使用，请先联系权利人取得许可。

## 贡献与反馈

欢迎提交节点命名兼容性、规则误分流、文档改进与测试用例。提交问题时，请提供脱敏后的节点名称、命中的策略组、预期策略组和 FlClash 版本；不要公开订阅链接、节点地址、令牌或个人信息。

## References

[1]: https://github.com/chen08209/FlClash "FlClash 官方仓库"
[2]: https://github.com/blackmatrix7/ios_rule_script "blackmatrix7/ios_rule_script"
[3]: https://github.com/IvanSolis1989/Smart-Config-Kit "Smart-Config-Kit"
[4]: https://github.com/MetaCubeX/mihomo "Mihomo"
