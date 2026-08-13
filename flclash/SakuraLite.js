// Sakura Lite · 樱语分流（移动端精简版）
// FlClash 覆写入口：main(config)

var VERSION = '1.1.0'
var TEST_URL = 'https://www.gstatic.com/generate_204'
var NAME = {
  MAIN: '🌸 代理选择', ALL: '🌌 全部节点', HK: '🏮 香港结界',
  TW: '🪭 台湾结界', JP: '🎐 日本结界', SG: '🦁 狮城结界',
  US: '🗽 北美结界', OTHER: '🌙 其他次元', AI: '🤖 AI 魔法工坊',
  MEDIA: '📺 追番放映室', GOOGLE: '🔍 Google 魔导书', DEV: '🧰 开发者工坊',
  GLOBAL: '🌐 异界漫游', CN: '🏯 国风直连', FINAL: '✨ 漏网之鱼', AD: '🛡️ 广告退散'
}

var REGIONS = [
  { id: 'HK', name: NAME.HK, test: /香港|hong\s?-?\s?kong|\bhkg?\b/i },
  { id: 'TW', name: NAME.TW, test: /台湾|台北|taiwan|taipei|\btwn?\b/i },
  { id: 'JP', name: NAME.JP, test: /日本|东京|大阪|japan|tokyo|osaka|\bjpn?\b/i },
  { id: 'SG', name: NAME.SG, test: /新加坡|singapore|\bsgp?\b/i },
  { id: 'US', name: NAME.US, test: /美国|洛杉矶|西雅图|纽约|america|usa|los\s+angeles|seattle|new\s+york|\bus\b/i }
]
var INFO = /剩余|流量|到期|重置|官网|订阅|套餐|\b(?:total|used|expire|email|website)\b/i

function log(message) {
  if (typeof console !== 'undefined' && console.log) console.log('[SakuraLite ' + VERSION + '] ' + message)
}

function unique(list) {
  var result = []
  var seen = {}
  for (var i = 0; i < list.length; i += 1) {
    if (list[i] && !seen[list[i]]) {
      seen[list[i]] = true
      result.push(list[i])
    }
  }
  return result
}

function replace(list, values) {
  list.splice(0, list.length)
  for (var i = 0; i < values.length; i += 1) list.push(values[i])
}

function regionOf(name) {
  for (var i = 0; i < REGIONS.length; i += 1) {
    if (REGIONS[i].test.test(name)) return REGIONS[i].id
  }
  return 'OTHER'
}

function collect(proxies) {
  var buckets = { ALL: [], HK: [], TW: [], JP: [], SG: [], US: [], OTHER: [] }
  for (var i = 0; i < proxies.length; i += 1) {
    if (!proxies[i] || !proxies[i].name) continue
    var name = String(proxies[i].name)
    if (INFO.test(name)) continue
    buckets.ALL.push(name)
    buckets[regionOf(name)].push(name)
  }
  return buckets
}

function urlTest(name, proxies) {
  return { name: name, type: 'url-test', url: TEST_URL, interval: 600, tolerance: 50, lazy: true, proxies: proxies.slice() }
}

function select(name, proxies) {
  return { name: name, type: 'select', proxies: unique(proxies) }
}

function activeNames(buckets) {
  var names = [NAME.ALL]
  for (var i = 0; i < REGIONS.length; i += 1) {
    if (buckets[REGIONS[i].id].length) names.push(REGIONS[i].name)
  }
  if (buckets.OTHER.length) names.push(NAME.OTHER)
  return names
}

function candidates(names, directFirst) {
  var result = names.slice()
  if (directFirst) result.unshift('DIRECT')
  else result.push('DIRECT')
  return result
}

function buildGroups(buckets) {
  var active = activeNames(buckets)
  var groups = [urlTest(NAME.ALL, buckets.ALL)]
  for (var i = 0; i < REGIONS.length; i += 1) {
    var region = REGIONS[i]
    if (buckets[region.id].length) groups.push(urlTest(region.name, buckets[region.id]))
  }
  if (buckets.OTHER.length) groups.push(urlTest(NAME.OTHER, buckets.OTHER))

  groups.push(select(NAME.MAIN, candidates(active, false)))
  groups.push(select(NAME.AI, candidates([NAME.US, NAME.SG, NAME.JP, NAME.ALL], false)))
  groups.push(select(NAME.MEDIA, candidates([NAME.HK, NAME.TW, NAME.JP, NAME.US, NAME.SG, NAME.ALL], false)))
  groups.push(select(NAME.GOOGLE, candidates([NAME.US, NAME.JP, NAME.SG, NAME.ALL], false)))
  groups.push(select(NAME.DEV, candidates([NAME.US, NAME.JP, NAME.SG, NAME.ALL], false)))
  groups.push(select(NAME.GLOBAL, candidates(active, false)))
  groups.push(select(NAME.CN, candidates(active, true)))
  groups.push(select(NAME.FINAL, candidates(active, false)))
  groups.push(select(NAME.AD, ['REJECT', 'DIRECT']))
  return groups
}

function ruleProvider(path, file) {
  return { type: 'http', behavior: 'classical', format: 'yaml', url: 'https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/' + path, path: './ruleset/sakura-lite/' + file, interval: 86400 }
}

function installRules(config) {
  config['rule-providers'] = {
    'sakura-ad': ruleProvider('rule/Clash/AdvertisingLite/AdvertisingLite_Classical.yaml', 'ad.yaml'),
    'sakura-cn': ruleProvider('rule/Clash/ChinaMax/ChinaMax_Classical.yaml', 'cn.yaml'),
    'sakura-global': ruleProvider('rule/Clash/Global/Global_Classical.yaml', 'global.yaml')
  }
  var rules = [
    'DOMAIN-SUFFIX,lan,DIRECT', 'DOMAIN-SUFFIX,local,DIRECT',
    'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve', 'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve', 'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
    'RULE-SET,sakura-ad,' + NAME.AD,
    'DOMAIN-SUFFIX,openai.com,' + NAME.AI, 'DOMAIN-SUFFIX,chatgpt.com,' + NAME.AI, 'DOMAIN-SUFFIX,claude.ai,' + NAME.AI, 'DOMAIN-SUFFIX,anthropic.com,' + NAME.AI, 'DOMAIN-SUFFIX,generativelanguage.googleapis.com,' + NAME.AI,
    'DOMAIN-SUFFIX,youtube.com,' + NAME.MEDIA, 'DOMAIN-SUFFIX,googlevideo.com,' + NAME.MEDIA, 'DOMAIN-SUFFIX,netflix.com,' + NAME.MEDIA, 'DOMAIN-SUFFIX,nflxvideo.net,' + NAME.MEDIA,
    'DOMAIN-SUFFIX,google.com,' + NAME.GOOGLE, 'DOMAIN-SUFFIX,googleapis.com,' + NAME.GOOGLE, 'DOMAIN-SUFFIX,gstatic.com,' + NAME.GOOGLE,
    'DOMAIN-SUFFIX,github.com,' + NAME.DEV, 'DOMAIN-SUFFIX,githubusercontent.com,' + NAME.DEV, 'DOMAIN-SUFFIX,githubassets.com,' + NAME.DEV, 'DOMAIN-SUFFIX,gitlab.com,' + NAME.DEV,
    'RULE-SET,sakura-cn,' + NAME.CN, 'GEOIP,CN,' + NAME.CN + ',no-resolve', 'RULE-SET,sakura-global,' + NAME.GLOBAL, 'MATCH,' + NAME.FINAL
  ]
  if (!Array.isArray(config.rules)) config.rules = []
  replace(config.rules, rules)
}

function main(config) {
  try {
    if (!config || !Array.isArray(config.proxies)) return config
    var buckets = collect(config.proxies)
    if (!buckets.ALL.length) return config
    if (!Array.isArray(config['proxy-groups'])) config['proxy-groups'] = []
    replace(config['proxy-groups'], buildGroups(buckets))
    config['unified-delay'] = true
    config['tcp-concurrent'] = true
    config.ipv6 = false
    if (!config.dns || typeof config.dns !== 'object' || Array.isArray(config.dns)) config.dns = {}
    config.dns.ipv6 = false
    config.dns['respect-rules'] = true
    installRules(config)
    log('已生成 ' + config['proxy-groups'].length + ' 个策略组。')
    return config
  } catch (error) {
    log('已保留原配置：' + String(error))
    return config
  }
}
