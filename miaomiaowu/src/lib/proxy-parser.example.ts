/**
 * 代理协议解析工具使用示例
 */

import { parseProxyUrl, parseSubscription, toClashProxy, generateClashProxiesConfig } from './proxy-parser'

// ============= 使用示例 =============

// 示例1: 解析单个 VMess URL
const vmessExample = () => {
  const vmessUrl = 'vmess://eyJhZGQiOiIxMjcuMC4wLjEiLCJhaWQiOiIwIiwiaG9zdCI6IiIsImlkIjoiMTIzNDU2NzgtMTIzNC0xMjM0LTEyMzQtMTIzNDU2Nzg5YWJjIiwibmV0IjoidGNwIiwicGF0aCI6IiIsInBvcnQiOiI0NDMiLCJwcyI6IlRlc3QgTm9kZSIsInNjeSI6ImF1dG8iLCJzbmkiOiIiLCJ0bHMiOiJ0bHMiLCJ0eXBlIjoibm9uZSIsInYiOiIyIn0='

  const node = parseProxyUrl(vmessUrl)
  console.log('VMess Node:', node)

  if (node) {
    const clashProxy = toClashProxy(node)
    console.log('Clash Proxy:', clashProxy)
  }
}

// 示例2: 解析 Shadowsocks URL
const ssExample = () => {
  const ssUrl = 'ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@example.com:8388#My%20SS%20Node'

  const node = parseProxyUrl(ssUrl)
  console.log('SS Node:', node)
}

// 示例3: 解析 Trojan URL
const trojanExample = () => {
  const trojanUrl = 'trojan://password123@example.com:443?sni=example.com&alpn=h2,http/1.1#Trojan%20Node'

  const node = parseProxyUrl(trojanUrl)
  console.log('Trojan Node:', node)
}

// 示例4: 解析 VLESS URL
const vlessExample = () => {
  const vlessUrl = 'vless://12345678-1234-1234-1234-123456789abc@example.com:443?type=ws&security=tls&path=/path&host=example.com#VLESS%20Node'

  const node = parseProxyUrl(vlessUrl)
  console.log('VLESS Node:', node)
}

// 示例5: 解析 Hysteria2 URL
const hysteria2Example = () => {
  const hy2Url = 'hysteria2://password@example.com:443?sni=example.com&obfs=salamander&obfsParam=secret#HY2%20Node'

  const node = parseProxyUrl(hy2Url)
  console.log('Hysteria2 Node:', node)
}

// 示例6: 解析 TUIC URL
const tuicExample = () => {
  const tuicUrl = 'tuic://uuid-here@example.com:443?password=pass&sni=example.com&congestion_control=bbr#TUIC%20Node'

  const node = parseProxyUrl(tuicUrl)
  console.log('TUIC Node:', node)
}

// 示例7: 解析订阅内容（多个节点）
const subscriptionExample = () => {
  const subscriptionContent = `
vmess://eyJhZGQiOiIxMjcuMC4wLjEiLCJhaWQiOiIwIiwiaG9zdCI6IiIsImlkIjoiMTIzNDU2NzgtMTIzNC0xMjM0LTEyMzQtMTIzNDU2Nzg5YWJjIiwibmV0IjoidGNwIiwicGF0aCI6IiIsInBvcnQiOiI0NDMiLCJwcyI6IlZNZXNzIE5vZGUiLCJzY3kiOiJhdXRvIiwic25pIjoiIiwidGxzIjoidGxzIiwidHlwZSI6Im5vbmUiLCJ2IjoiMiJ9
trojan://password@example.com:443?sni=example.com#Trojan%20Node
ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ=@example.com:8388#SS%20Node
  `.trim()

  const proxies = parseSubscription(subscriptionContent)
  console.log('Parsed Proxies:', proxies)

  // 生成 Clash 配置
  const clashConfig = generateClashProxiesConfig(proxies)
  console.log('Clash Config:\n', clashConfig)
}

// 示例8: 解析 base64 编码的订阅内容
const base64SubscriptionExample = () => {
  // 假设这是从订阅 URL 获取的 base64 编码内容
  const base64Content = 'dm1lc3M6Ly9leUpoWkdRaU9pSXhNamN1TUM0d0xqRWlMQ0poYVdRaU9pSXdJaXdpYUc5emRDSTZJaUlzSW1sa0lqb2lNVEl6TkRVMk56Z3RNVEl6TkMweE1qTTBMVEV5TXpRdE1USXpORFUyTnpnNVlXSmpJaXdpYm1WMElqb2lkR053SWl3aWNHRjBhQ0k2SWlJc0luQnZjblFpT2lJME5ETWlMQ0p3Y3lJNklsWk5aWE56SUU1dlpHVWlMQ0p6WTNraU9pSmhkWFJ2SWl3aWMyNXBJam9pSWl3aWRHeHpJam9pZEd4eklpd2lkSGx3WlNJNkltNXZibVVpTENKMklqb2lNaUo5'

  const proxies = parseSubscription(base64Content)
  console.log('Parsed Proxies from base64:', proxies)
}

// 示例9: 在 React 组件中使用
const ReactComponentExample = `
import { useState } from 'react'
import { parseSubscription, type ClashProxy } from '@/lib/proxy-parser'

function SubscriptionParser() {
  const [url, setUrl] = useState('')
  const [proxies, setProxies] = useState<ClashProxy[]>([])
  const [loading, setLoading] = useState(false)

  const handleParse = async () => {
    if (!url) return

    setLoading(true)
    try {
      // 从订阅 URL 获取内容
      const response = await fetch(url)
      const content = await response.text()

      // 解析订阅内容
      const parsedProxies = parseSubscription(content)
      setProxies(parsedProxies)
    } catch (error) {
      console.error('Parse error:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="输入订阅 URL"
      />
      <button onClick={handleParse} disabled={loading}>
        {loading ? '解析中...' : '解析订阅'}
      </button>

      <div>
        <h3>解析结果 ({proxies.length} 个节点)</h3>
        {proxies.map((proxy, index) => (
          <div key={index}>
            <strong>{proxy.name}</strong> - {proxy.type} - {proxy.server}:{proxy.port}
          </div>
        ))}
      </div>
    </div>
  )
}
`

// 导出示例函数
export {
  vmessExample,
  ssExample,
  trojanExample,
  vlessExample,
  hysteria2Example,
  tuicExample,
  subscriptionExample,
  base64SubscriptionExample,
  ReactComponentExample
}
