const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '..', 'SakuraRoute.js'), 'utf8')
const sandbox = { console: { log() {} } }
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'SakuraRoute.js' })

assert.equal(typeof sandbox.main, 'function', '覆写入口 main(config) 必须存在')

const config = {
  proxies: [
    { name: '🇭🇰 香港 01' },
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
assert.deepEqual(Object.keys(config['rule-providers']).sort(), ['sakura-ad', 'sakura-cn', 'sakura-global'])
assert.equal(config.ipv6, false)
assert.equal(config.dns.ipv6, false)
assert.equal(config.dns['respect-rules'], true)
assert.deepEqual(config.dns.nameserver, ['https://example-dns.invalid/dns-query'], '不得接管既有 DNS 服务器')
assert.equal(config['proxy-groups'][0].name, '🌌 全部节点')
assert.equal(config['proxy-groups'][1].name, '🏮 香港结界')
assert.equal(config['proxy-groups'][6].name, '🌙 其他次元')
assert.ok(config['proxy-groups'].some((group) => group.name === '🤖 AI 魔法工坊'))
assert.ok(config['proxy-groups'].some((group) => group.name === '🛡️ 广告退散'))
assert.ok(config.rules.includes('MATCH,✨ 漏网之鱼'))
assert.ok(!config['proxy-groups'].some((group) => group.name === '机场旧组'))
assert.ok(!config.rules.includes('MATCH,DIRECT'))

const noNodes = { proxies: [{ name: '套餐到期：2026-12-31' }], rules: ['MATCH,DIRECT'] }
assert.equal(sandbox.main(noNodes), noNodes)
assert.deepEqual(noNodes.rules, ['MATCH,DIRECT'], '信息行不能触发配置重建')

console.log('SakuraRoute tests passed')
