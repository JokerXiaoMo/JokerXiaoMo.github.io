// FlClash 覆写脚本：山海行 · 国风分流
// 适用：FlClash v0.8.85+（标准 Mihomo 内核）
// 设计：动态节点分组 + 少量常用业务策略 + 三个远程规则集；不接管订阅节点与 DNS 服务器。

var VERSION = '1.0.0'
var TEST_URL = 'https://www.gstatic.com/generate_204'
var TEST_INTERVAL = 600
var TEST_TOLERANCE = 50

var NAME = {
  MAIN: '🌺 代理选择',
  ALL: '☁️ 万象节点',
  HK: '🏮 香江灯影',
  TW: '🪭 宝岛团扇',
  JP: '🍑 东海桃影',
  SG: '🪷 南洋莲舟',
  US: '⛵ 北美远航',
  OTHER: '⛰️ 四海云游',
  AI: '📜 灵枢智算',
  MEDIA: '🎭 梨园影音',
  GOOGLE: '🔭 云台观星',
  DEV: '🧰 百工工坊',
  GLOBAL: '🗺️ 山海行旅',
  CN: '🧧 神州直连',
  FINAL: '🌺 桃源归途',
  AD: '🛡️ 清风拂尘'
}

var REGIONS = [
  { key: 'HK', name: NAME.HK, pattern: /香港|澳门|澳門|hong\s?-?\s?kong|maca[ou]|\bhkg?\b|\bmo[\s_#-]*\d/i },
  { key: 'TW', name: NAME.TW, pattern: /台湾|台北|taiwan|taipei|\btwn?\b/i },
  { key: 'JP', name: NAME.JP, pattern: /日本|东京|大阪|japan|tokyo|osaka|\bjpn?\b/i },
  { key: 'SG', name: NAME.SG, pattern: /新加坡|singapore|\bsgp?\b/i },
  { key: 'US', name: NAME.US, pattern: /美国|洛杉矶|西雅图|纽约|united\s+states|america|usa|los\s+angeles|seattle|new\s+york|\bus\b/i }
]

var INFO_NODE = /剩余|流量|到期|重置|官网|订阅|网址|套餐|邮箱|\b(?:total|used|expire|email|website|channel)\b/i

function log(message) {
  if (typeof console !== 'undefined' && console.log) console.log('[山海行 ' + VERSION + '] ' + message)
}

function unique(list) {
  var output = []
  var seen = {}
  for (var i = 0; i < list.length; i += 1) {
    var item = list[i]
    if (!item || seen[item]) continue
    seen[item] = true
    output.push(item)
  }
  return output
}

function ensureArray(object, key) {
  if (!Array.isArray(object[key])) object[key] = []
  return object[key]
}

function replaceArray(target, values) {
  target.splice(0, target.length)
  for (var i = 0; i < values.length; i += 1) target.push(values[i])
}

function newUrlTest(name, proxies) {
  return {
    name: name,
    type: 'url-test',
    url: TEST_URL,
    interval: TEST_INTERVAL,
    tolerance: TEST_TOLERANCE,
    lazy: true,
    proxies: proxies.slice()
  }
}

function newSelect(name, proxies) {
  return { name: name, type: 'select', proxies: unique(proxies) }
}

function detectRegion(nodeName) {
  for (var i = 0; i < REGIONS.length; i += 1) {
    if (REGIONS[i].pattern.test(nodeName)) return REGIONS[i].key
  }
  return 'OTHER'
}

function collectNodes(proxies) {
  var buckets = { ALL: [], HK: [], TW: [], JP: [], SG: [], US: [], OTHER: [] }
  for (var i = 0; i < proxies.length; i += 1) {
    var proxy = proxies[i]
    if (!proxy || typeof proxy !== 'object' || !proxy.name) continue
    var nodeName = String(proxy.name)
    if (INFO_NODE.test(nodeName)) continue
    buckets.ALL.push(nodeName)
    buckets[detectRegion(nodeName)].push(nodeName)
  }
  return buckets
}

function activeRegionNames(buckets) {
  var names = [NAME.ALL]
  for (var i = 0; i < REGIONS.length; i += 1) {
    if (buckets[REGIONS[i].key].length > 0) names.push(REGIONS[i].name)
  }
  if (buckets.OTHER.length > 0) names.push(NAME.OTHER)
  return names
}

function selectCandidates(regions, directFirst) {
  var choices = regions.slice()
  if (directFirst) choices.unshift('DIRECT')
  else choices.push('DIRECT')
  return choices
}

function buildGroups(buckets) {
  var regions = activeRegionNames(buckets)
  // 总开关置顶，便于在 FlClash 代理页首项直接切换。
  var groups = [newSelect(NAME.MAIN, selectCandidates(regions, false))]
  groups.push(newUrlTest(NAME.ALL, buckets.ALL))

  for (var i = 0; i < REGIONS.length; i += 1) {
    var region = REGIONS[i]
    if (buckets[region.key].length > 0) groups.push(newUrlTest(region.name, buckets[region.key]))
  }
  if (buckets.OTHER.length > 0) groups.push(newUrlTest(NAME.OTHER, buckets.OTHER))

  groups.push(newSelect(NAME.AI, selectCandidates([NAME.US, NAME.SG, NAME.JP, NAME.ALL], false)))
  groups.push(newSelect(NAME.MEDIA, selectCandidates([NAME.HK, NAME.TW, NAME.JP, NAME.US, NAME.SG, NAME.ALL], false)))
  groups.push(newSelect(NAME.GOOGLE, selectCandidates([NAME.US, NAME.JP, NAME.SG, NAME.ALL], false)))
  groups.push(newSelect(NAME.DEV, selectCandidates([NAME.US, NAME.JP, NAME.SG, NAME.ALL], false)))
  groups.push(newSelect(NAME.GLOBAL, selectCandidates(regions, false)))
  groups.push(newSelect(NAME.CN, selectCandidates(regions, true)))
  groups.push(newSelect(NAME.FINAL, selectCandidates(regions, false)))
  groups.push(newSelect(NAME.AD, ['REJECT', 'DIRECT']))
  return groups
}

function provider(path, localPath) {
  return {
    type: 'http',
    behavior: 'classical',
    format: 'yaml',
    url: 'https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/' + path,
    path: './ruleset/shanhai-xing/' + localPath,
    interval: 86400
  }
}

function installRules(config) {
  config['rule-providers'] = {
    'shanhai-ad': provider('rule/Clash/AdvertisingLite/AdvertisingLite_Classical.yaml', 'advertising-lite.yaml'),
    'shanhai-cn': provider('rule/Clash/ChinaMax/ChinaMax_Classical.yaml', 'china-max.yaml'),
    'shanhai-global': provider('rule/Clash/Global/Global_Classical.yaml', 'global.yaml')
  }

  var rules = [
    'DOMAIN-SUFFIX,lan,DIRECT',
    'DOMAIN-SUFFIX,local,DIRECT',
    'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
    'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve',
    'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
    'RULE-SET,shanhai-ad,' + NAME.AD,
    'DOMAIN-SUFFIX,openai.com,' + NAME.AI,
    'DOMAIN-SUFFIX,chatgpt.com,' + NAME.AI,
    'DOMAIN-SUFFIX,claude.ai,' + NAME.AI,
    'DOMAIN-SUFFIX,anthropic.com,' + NAME.AI,
    'DOMAIN-SUFFIX,generativelanguage.googleapis.com,' + NAME.AI,
    'DOMAIN-SUFFIX,youtube.com,' + NAME.MEDIA,
    'DOMAIN-SUFFIX,googlevideo.com,' + NAME.MEDIA,
    'DOMAIN-SUFFIX,netflix.com,' + NAME.MEDIA,
    'DOMAIN-SUFFIX,nflxvideo.net,' + NAME.MEDIA,
    'DOMAIN-SUFFIX,google.com,' + NAME.GOOGLE,
    'DOMAIN-SUFFIX,googleapis.com,' + NAME.GOOGLE,
    'DOMAIN-SUFFIX,gstatic.com,' + NAME.GOOGLE,
    'DOMAIN-SUFFIX,github.com,' + NAME.DEV,
    'DOMAIN-SUFFIX,githubusercontent.com,' + NAME.DEV,
    'DOMAIN-SUFFIX,githubassets.com,' + NAME.DEV,
    'DOMAIN-SUFFIX,gitlab.com,' + NAME.DEV,
    'RULE-SET,shanhai-cn,' + NAME.CN,
    'GEOIP,CN,' + NAME.CN + ',no-resolve',
    'RULE-SET,shanhai-global,' + NAME.GLOBAL,
    'MATCH,' + NAME.FINAL
  ]
  replaceArray(ensureArray(config, 'rules'), rules)
}

function applySafeDefaults(config) {
  config['unified-delay'] = true
  config['tcp-concurrent'] = true
  config.ipv6 = false

  if (!config.dns || typeof config.dns !== 'object' || Array.isArray(config.dns)) config.dns = {}
  config.dns.ipv6 = false
  config.dns['respect-rules'] = true

  if (!config.profile || typeof config.profile !== 'object' || Array.isArray(config.profile)) config.profile = {}
  config.profile['store-selected'] = true
}

function main(config) {
  try {
    if (!config || typeof config !== 'object') return config
    if (!Array.isArray(config.proxies) || config.proxies.length === 0) {
      log('未发现可用节点，跳过覆写。')
      return config
    }

    var nodes = collectNodes(config.proxies)
    if (nodes.ALL.length === 0) {
      log('节点均为订阅信息行，跳过覆写。')
      return config
    }

    applySafeDefaults(config)
    replaceArray(ensureArray(config, 'proxy-groups'), buildGroups(nodes))
    installRules(config)

    log('完成：' + nodes.ALL.length + ' 个节点，' + config['proxy-groups'].length + ' 个策略组，' + config.rules.length + ' 条规则。')
    return config
  } catch (error) {
    log('发生错误，保留原配置：' + String(error))
    return config
  }
}

// FlClash 以 main(config) 作为覆写脚本入口。
