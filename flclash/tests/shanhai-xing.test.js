const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '..', 'ShanHaiXing.js'), 'utf8')
const sandbox = { console: { log() {} } }
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'ShanHaiXing.js' })

assert.equal(typeof sandbox.main, 'function', '覆写入口 main(config) 必须存在')

const config = {
  proxies: [
    { name: '🇭🇰 香港 01' },
    { name: '🇲🇴 澳门 MO-01' },
    { name: 'Macau 02' },
    { name: 'Macao-MO03' },
    { name: 'MO_04' },
    { name: 'Taiwan-TW-02' },
    { name: 'Tokyo JP 03' },
    { name: 'Singapore SG 04' },
    { name: 'US Los Angeles 05' },
    { name: 'Germany DE 06' },
    { name: '剩余流量：99GB' }
  ],
  'proxy-groups': [{ name: '机场旧组', type: 'select', proxies: ['🇭🇰 香港 01'] }],
  rules: ['MATCH,DIRECT'],
  'rule-providers': { legacy: { type: 'http' } },
  dns: { nameserver: ['https://example-dns.invalid/dns-query'] }
}

const output = sandbox.main(config)
assert.equal(output, config, '应原地返回同一配置对象')
assert.equal(config['proxy-groups'].length, 16, '应构建 7 个区域组与 9 个业务组')
assert.equal(config.rules.length, 26, '应构建精简的 26 条规则')
assert.deepEqual(Object.keys(config['rule-providers']).sort(), ['shanhai-ad', 'shanhai-cn', 'shanhai-global'])
assert.equal(config.ipv6, false)
assert.equal(config.dns.ipv6, false)
assert.equal(config.dns['respect-rules'], true)
assert.deepEqual(config.dns.nameserver, ['https://example-dns.invalid/dns-query'], '不得接管既有 DNS 服务器')
assert.equal(config['proxy-groups'][0].name, '🌺 代理选择', '代理选择必须始终置顶')
assert.equal(config['proxy-groups'][1].name, '☁️ 万象节点')
assert.equal(config['proxy-groups'][2].name, '🏮 香江灯影')
assert.equal(config['proxy-groups'][7].name, '⛰️ 四海云游')

const allGroup = config['proxy-groups'][1]
const hongKongGroup = config['proxy-groups'][2]
assert.equal(allGroup.type, 'url-test')
assert.equal(allGroup.url, 'https://www.gstatic.com/generate_204')
assert.equal(allGroup.interval, 600)
assert.equal(allGroup.tolerance, 50)
assert.equal(allGroup.lazy, true)
;['🇲🇴 澳门 MO-01', 'Macau 02', 'Macao-MO03', 'MO_04'].forEach((node) => {
  assert.ok(hongKongGroup.proxies.includes(node), node + ' 必须归入香江灯影')
})
assert.ok(config['proxy-groups'][0].proxies.includes('🏮 香江灯影'), '代理选择应可直接选择香江灯影')
assert.ok(config['proxy-groups'].some((group) => group.name === '📜 灵枢智算'))
assert.ok(config['proxy-groups'].some((group) => group.name === '🛡️ 清风拂尘'))
assert.ok(config.rules.includes('DOMAIN-SUFFIX,openai.com,📜 灵枢智算'))
assert.ok(config.rules.includes('DOMAIN-SUFFIX,youtube.com,🎭 梨园影音'))
assert.ok(config.rules.includes('DOMAIN-SUFFIX,github.com,🧰 百工工坊'))
assert.ok(config.rules.includes('GEOIP,CN,🧧 神州直连,no-resolve'))
assert.ok(config.rules.includes('MATCH,🌺 桃源归途'))
assert.ok(!config['proxy-groups'].some((group) => group.name === '机场旧组'))
assert.ok(!config.rules.includes('MATCH,DIRECT'))

const noNodes = { proxies: [{ name: '套餐到期：2026-12-31' }], rules: ['MATCH,DIRECT'] }
assert.equal(sandbox.main(noNodes), noNodes)
assert.deepEqual(noNodes.rules, ['MATCH,DIRECT'], '信息行不能触发配置重建')

console.log('ShanHaiXing tests passed')
