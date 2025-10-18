/**
 * 代理协议解析工具测试文件
 * 用于快速测试各种代理协议的解析功能
 */

import { parseProxyUrl, toClashProxy } from './proxy-parser'

// ============= 测试函数 =============

/**
 * 测试 VLESS 协议解析
 */
export function testVless(vlessUrl: string) {
  console.log('==================== VLESS 解析测试 ====================')
  console.log('原始 URL:')
  console.log(vlessUrl)
  console.log('\n')

  try {
    const node = parseProxyUrl(vlessUrl)

    if (!node) {
      console.error('❌ 解析失败: 返回 null')
      return null
    }

    console.log('✅ 解析成功!')
    console.log('\n📋 解析结果 (ProxyNode):')
    console.log(JSON.stringify(node, null, 2))

    console.log('\n🔄 转换为 Clash 格式:')
    const clashProxy = toClashProxy(node)
    console.log(JSON.stringify(clashProxy, null, 2))

    console.log('\n📊 节点信息摘要:')
    console.log(`  名称: ${node.name}`)
    console.log(`  类型: ${node.type}`)
    console.log(`  服务器: ${node.server}`)
    console.log(`  端口: ${node.port}`)
    console.log(`  UUID: ${node.uuid}`)
    console.log(`  网络类型: ${node.network}`)
    console.log(`  TLS: ${node.tls ? '是' : '否'}`)
    console.log(`  服务器名称 (SNI): ${node.servername}`)

    if (node.network === 'ws' && node['ws-opts']) {
      console.log(`  WebSocket 路径: ${node['ws-opts'].path}`)
      console.log(`  WebSocket Host: ${node['ws-opts'].headers?.Host || '无'}`)
    }

    if (node.network === 'grpc' && node['grpc-opts']) {
      console.log(`  gRPC 服务名: ${node['grpc-opts']['grpc-service-name']}`)
    }

    return node
  } catch (error) {
    console.error('❌ 解析出错:', error)
    return null
  }
}

/**
 * 测试所有协议
 */
export function testAllProtocols(urls: Record<string, string>) {
  console.log('==================== 批量协议解析测试 ====================\n')

  const results: Record<string, any> = {}

  Object.entries(urls).forEach(([protocol, url]) => {
    console.log(`\n🔍 测试 ${protocol.toUpperCase()} 协议:`)
    console.log('-'.repeat(60))

    try {
      const node = parseProxyUrl(url)

      if (node) {
        console.log(`✅ ${protocol} 解析成功`)
        console.log(`   名称: ${node.name}`)
        console.log(`   服务器: ${node.server}:${node.port}`)
        results[protocol] = { success: true, node }
      } else {
        console.log(`❌ ${protocol} 解析失败`)
        results[protocol] = { success: false }
      }
    } catch (error) {
      console.error(`❌ ${protocol} 解析出错:`, error)
      results[protocol] = { success: false, error }
    }
  })

  console.log('\n\n==================== 测试汇总 ====================')
  const successCount = Object.values(results).filter(r => r.success).length
  const totalCount = Object.keys(results).length
  console.log(`✅ 成功: ${successCount}/${totalCount}`)
  console.log(`❌ 失败: ${totalCount - successCount}/${totalCount}`)

  return results
}

// ============= 示例 VLESS URL (可以替换成你自己的) =============

const exampleVlessUrls = {
  // VLESS + TCP + TLS
  vlessTcp: 'vless://12345678-1234-1234-1234-123456789abc@example.com:443?security=tls&sni=example.com&type=tcp#VLESS-TCP-TLS',

  // VLESS + WebSocket + TLS
  vlessWs: 'vless://12345678-1234-1234-1234-123456789abc@example.com:443?type=ws&security=tls&path=/websocket&host=example.com&sni=example.com#VLESS-WS-TLS',

  // VLESS + gRPC + TLS
  vlessGrpc: 'vless://12345678-1234-1234-1234-123456789abc@example.com:443?type=grpc&security=tls&serviceName=mygrpc&sni=example.com#VLESS-gRPC-TLS',

  // VLESS + Reality
  vlessReality: 'vless://12345678-1234-1234-1234-123456789abc@example.com:443?type=tcp&security=reality&sni=example.com&flow=xtls-rprx-vision#VLESS-Reality',
}

// ============= 快速测试方法 =============

/**
 * 方法 1: 在浏览器控制台测试
 *
 * 1. 打开浏览器开发者工具 (F12)
 * 2. 在 Console 中导入测试函数:
 *    import { testVless } from '@/lib/proxy-parser.test'
 *
 * 3. 运行测试:
 *    testVless('你的 VLESS URL')
 */

/**
 * 方法 2: 创建一个测试页面组件
 */
export const VlessTestComponent = `
import { useState } from 'react'
import { testVless } from '@/lib/proxy-parser.test'

export function VlessTest() {
  const [url, setUrl] = useState('')
  const [result, setResult] = useState<any>(null)

  const handleTest = () => {
    const node = testVless(url)
    setResult(node)
  }

  return (
    <div style={{ padding: '20px', maxWidth: '800px' }}>
      <h2>VLESS 配置解析测试</h2>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px' }}>
          输入 VLESS URL:
        </label>
        <textarea
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="vless://..."
          style={{
            width: '100%',
            height: '100px',
            padding: '8px',
            fontFamily: 'monospace',
            fontSize: '12px'
          }}
        />
      </div>

      <button
        onClick={handleTest}
        style={{
          padding: '10px 20px',
          background: '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer'
        }}
      >
        解析测试
      </button>

      {result && (
        <div style={{ marginTop: '20px' }}>
          <h3>解析结果:</h3>
          <pre style={{
            background: '#f5f5f5',
            padding: '15px',
            borderRadius: '4px',
            overflow: 'auto'
          }}>
            {JSON.stringify(result, null, 2)}
          </pre>

          <div style={{ marginTop: '15px', lineHeight: '1.8' }}>
            <h4>节点信息:</h4>
            <div>名称: {result.name}</div>
            <div>类型: {result.type}</div>
            <div>服务器: {result.server}:{result.port}</div>
            <div>UUID: {result.uuid}</div>
            <div>网络: {result.network}</div>
            <div>TLS: {result.tls ? '是' : '否'}</div>
          </div>
        </div>
      )}
    </div>
  )
}
`

/**
 * 方法 3: 直接在这个文件中运行测试
 *
 * 取消下面的注释并替换成你的 VLESS URL
 */

// 示例: 测试单个 VLESS URL
export function runVlessTest() {
  const myVlessUrl = 'vless://your-uuid@your-server:443?type=ws&security=tls&path=/path&host=host.com#NodeName'

  // 替换上面的 URL 为你的实际 VLESS URL，然后运行这个函数
  return testVless(myVlessUrl)
}

// 示例: 测试多个 URL
export function runBatchTest() {
  const myUrls = {
    vless: 'vless://...',
    vmess: 'vmess://...',
    trojan: 'trojan://...',
    ss: 'ss://...',
  }

  return testAllProtocols(myUrls)
}

// ============= Node.js 环境测试 (可选) =============

/**
 * 如果你想在 Node.js 中测试，可以创建一个单独的测试脚本:
 *
 * // test-vless.js
 * const { parseProxyUrl } = require('./proxy-parser')
 *
 * const vlessUrl = 'vless://...'
 * const node = parseProxyUrl(vlessUrl)
 *
 * console.log('解析结果:', JSON.stringify(node, null, 2))
 *
 * 然后运行: node test-vless.js
 */

// 导出测试函数
export default {
  testVless,
  testAllProtocols,
  runVlessTest,
  runBatchTest,
  exampleVlessUrls
}
