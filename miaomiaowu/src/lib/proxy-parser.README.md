# 代理协议解析工具 (Proxy Parser)

用于解析各种代理协议的订阅链接，并转换为 Clash 节点格式。

## 支持的协议

- ✅ **VMess** - `vmess://`
- ✅ **VLESS** - `vless://`
- ✅ **Trojan** - `trojan://`
- ✅ **Shadowsocks** - `ss://`
- ✅ **SOCKS5** - `socks://`
- ✅ **Hysteria** - `hysteria://`
- ✅ **Hysteria2** - `hysteria2://` 或 `hy2://`
- ✅ **TUIC** - `tuic://`

## 协议格式说明

### VMess
```
vmess://base64(json)
```
- base64 编码的 JSON 配置
- JSON 中 `ps` 字段为节点名称

### Shadowsocks
```
ss://base64(method:password)@server:port#name
或
ss://base64(method:password@server:port)#name
```
- 协议头到 @ 之间为 base64 编码
- 内容为: `混淆方式:密码`

### SOCKS5
```
socks://base64(user:password)@server:port#name
```
- 协议头到 @ 之间为 base64 编码
- 内容为: `用户名:密码`

### 通用格式 (Trojan, VLESS, Hysteria, Hysteria2, TUIC)
```
protocol://password@server:port?key1=value1&key2=value2#name
```
- `password` 或 `uuid` 在 @ 之前
- 服务器地址和端口在 @ 之后
- 查询参数通过 `?` 和 `&` 连接
- `#` 后面为节点名称

## API 文档

### `parseProxyUrl(url: string): ProxyNode | null`

解析单个代理 URL。

**参数:**
- `url` - 代理协议 URL 字符串

**返回:**
- `ProxyNode` - 解析后的节点对象
- `null` - 解析失败

**示例:**
```typescript
import { parseProxyUrl } from '@/lib/proxy-parser'

const node = parseProxyUrl('vmess://...')
console.log(node)
// {
//   name: "节点名称",
//   type: "vmess",
//   server: "example.com",
//   port: 443,
//   uuid: "...",
//   ...
// }
```

### `parseSubscription(content: string): ClashProxy[]`

解析订阅内容（支持多行 URL 或 base64 编码的订阅）。

**参数:**
- `content` - 订阅内容（可以是多行 URL 或 base64 编码）

**返回:**
- `ClashProxy[]` - Clash 节点数组

**示例:**
```typescript
import { parseSubscription } from '@/lib/proxy-parser'

// 从订阅 URL 获取内容
const response = await fetch('https://example.com/subscription')
const content = await response.text()

// 解析订阅
const proxies = parseSubscription(content)
console.log(proxies)
// [
//   { name: "节点1", type: "vmess", server: "...", port: 443, ... },
//   { name: "节点2", type: "trojan", server: "...", port: 443, ... }
// ]
```

### `toClashProxy(node: ProxyNode): ClashProxy`

将通用节点对象转换为 Clash 格式。

**参数:**
- `node` - 通用节点对象

**返回:**
- `ClashProxy` - Clash 节点对象

### `generateClashProxiesConfig(proxies: ClashProxy[]): string`

生成 Clash 配置文件的 proxies 部分。

**参数:**
- `proxies` - Clash 节点数组

**返回:**
- `string` - YAML 格式的配置字符串

**示例:**
```typescript
import { parseSubscription, generateClashProxiesConfig } from '@/lib/proxy-parser'

const proxies = parseSubscription(subscriptionContent)
const config = generateClashProxiesConfig(proxies)

console.log(config)
// proxies:
//   - {"name":"节点1","type":"vmess","server":"...","port":443,...}
//   - {"name":"节点2","type":"trojan","server":"...","port":443,...}
```

## 使用示例

### 示例 1: 解析单个 URL

```typescript
import { parseProxyUrl } from '@/lib/proxy-parser'

const vmessUrl = 'vmess://eyJhZGQiOiJleGFtcGxlLmNvbSIsInBvcnQiOiI0NDMiLCJwcyI6Ik15IE5vZGUifQ=='
const node = parseProxyUrl(vmessUrl)

if (node) {
  console.log(`节点: ${node.name}`)
  console.log(`类型: ${node.type}`)
  console.log(`地址: ${node.server}:${node.port}`)
}
```

### 示例 2: 在 React 组件中使用

```typescript
import { useState } from 'react'
import { parseSubscription, type ClashProxy } from '@/lib/proxy-parser'

function SubscriptionParser() {
  const [url, setUrl] = useState('')
  const [proxies, setProxies] = useState<ClashProxy[]>([])

  const handleParse = async () => {
    try {
      const response = await fetch(url)
      const content = await response.text()
      const parsed = parseSubscription(content)
      setProxies(parsed)
    } catch (error) {
      console.error('解析失败:', error)
    }
  }

  return (
    <div>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="输入订阅 URL"
      />
      <button onClick={handleParse}>解析</button>

      <ul>
        {proxies.map((proxy, i) => (
          <li key={i}>
            {proxy.name} ({proxy.type}) - {proxy.server}:{proxy.port}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

### 示例 3: 批量转换

```typescript
import { parseSubscription, generateClashProxiesConfig } from '@/lib/proxy-parser'

async function convertSubscription(url: string) {
  // 获取订阅内容
  const response = await fetch(url)
  const content = await response.text()

  // 解析为 Clash 节点
  const proxies = parseSubscription(content)

  // 生成 Clash 配置
  const config = generateClashProxiesConfig(proxies)

  // 下载或保存配置
  const blob = new Blob([config], { type: 'text/yaml' })
  const downloadUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = downloadUrl
  a.download = 'clash-proxies.yaml'
  a.click()
}
```

### 示例 4: 过滤节点

```typescript
import { parseSubscription } from '@/lib/proxy-parser'

const content = await fetch(subscriptionUrl).then(r => r.text())
const proxies = parseSubscription(content)

// 只保留 VMess 和 Trojan 节点
const filtered = proxies.filter(p =>
  p.type === 'vmess' || p.type === 'trojan'
)

// 只保留名称包含 "香港" 的节点
const hkNodes = proxies.filter(p =>
  p.name.includes('香港') || p.name.includes('HK')
)

// 按类型分组
const grouped = proxies.reduce((acc, proxy) => {
  if (!acc[proxy.type]) acc[proxy.type] = []
  acc[proxy.type].push(proxy)
  return acc
}, {} as Record<string, ClashProxy[]>)
```

## 类型定义

```typescript
interface ProxyNode {
  name: string
  type: string
  server: string
  port: number
  password?: string
  uuid?: string
  method?: string
  cipher?: string
  [key: string]: unknown
}

interface ClashProxy {
  name: string
  type: string
  server: string
  port: number
  [key: string]: unknown
}
```

## 注意事项

1. **跨域问题**: 如果直接在浏览器中获取订阅 URL，可能会遇到 CORS 跨域问题。建议通过后端代理或使用支持 CORS 的订阅源。

2. **Base64 解码**: 工具会自动处理 URL Safe Base64 和标准 Base64 格式。

3. **错误处理**: 所有解析函数都包含错误处理，解析失败会返回 `null` 或空数组，不会抛出异常。

4. **协议变体**:
   - Hysteria2 支持 `hysteria2://` 和 `hy2://` 两种协议头
   - Shadowsocks 支持两种编码格式
   - VMess 的 JSON 字段可能因客户端而异

5. **性能**: 对于大量节点（1000+），建议分批处理或使用 Web Worker。

## 完整示例

查看 `proxy-parser.example.ts` 获取更多使用示例。
