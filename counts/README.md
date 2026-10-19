# 计数服务

站点的「N 次阅读」「已被打开 N 次」由这个小服务提供。站点本身托管在
GitHub Pages（纯静态），写不了文件，所以这两个数只能由外部记。

不想要这两个数也完全可以：`/data/stats.json` 里 `endpoint` 留空即可，
前端会把它们整块隐藏，不会显示 0，也不会显示旧值。

## 两种部署，任选一种

| | 需要什么 | 成本 | 适合 |
|---|---|---|---|
| `worker.js` | 一个 Cloudflare 账号 | 免费额度远超本站用量 | 没有常开的服务器 |
| `server.js` | 一台常开的机器 + 一个能上 https 的地址 | 自己维护 | 已经有服务器 |

两条路对外都是同一套接口，前端不区分，切换只改 `data/stats.json`。

## A · Cloudflare Worker

1. dash.cloudflare.com → Workers & Pages → 创建 Worker
2. 把 `worker.js` 全文贴进去，覆盖默认代码
3. Settings → Variables and Secrets → KV Namespace Bindings
   新建绑定，**变量名必须是 `COUNTS`**，选一个新 namespace
4. 部署，得到一个 `https://xxx.workers.dev`
5. 填进 `/data/stats.json`：

```json
{ "endpoint": "https://xxx.workers.dev" }
```

不用自己的域名 —— Worker 自带的 `workers.dev` 就是 https，站点打过去不算混合内容。

## B · 独立 Node

```bash
PORT=8710 DATA=/var/lib/taobai/counts.json node counts/server.js
```

再用 nginx / caddy 挂到 https 后面：

```nginx
location / {
  proxy_pass http://127.0.0.1:8710;
  proxy_set_header X-Real-IP $remote_addr;      # 必须，取真实来源靠它
  proxy_set_header X-Forwarded-For $remote_addr;
}
```

然后把 `https://你的域名` 填进 `data/stats.json`。

> 这一行别照抄成 `$proxy_add_x_forwarded_for`：那是"追加"，客户端自己带的
> `X-Forwarded-For` 会被原样保留在前面，服务端取到的是伪造值，去重就失效了。

## 接口

```
POST /hit     { "k": "a", "id": "art_xxx" }   →  { "n": 12 }
GET  /counts                                   →  { "a": {"art_x": 12}, "s": {"shr_y": 7} }
```

`k`：`a` = 文章阅读，`s` = 工具打开。

## 口径

- **同一个人同一天同一条只 +1**。认人的方式是 IP + UA 的短哈希，只存哈希不存 IP，
  第二天零点后重新计。
- 计数只增不减，没有"取关"这种操作。
- 服务挂了就静默，前端保持原样，不弹错误、不显示 0。

## 本机试一下

```bash
node counts/server.js &
curl -X POST localhost:8710/hit -H 'Content-Type: application/json' -d '{"k":"a","id":"art_test"}'
curl localhost:8710/counts
```

第一次会看到 `{"n":1}`，再发一次还是 `{"n":1}` —— 同一天同一个人不重复计，这是对的。
