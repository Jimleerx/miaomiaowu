import type { ProxyConfig } from './types'
import {
  decodeBase64,
  base64ToBinary,
  parseServerInfo,
  parseUrlParams,
  createTlsConfig,
  createTransportConfig,
} from './utils'

export class ProxyParser {
  static parse(url: string): ProxyConfig | null {
    url = url.trim()
    const type = url.split('://')[0]

    switch (type) {
      case 'ss':
        return new ShadowsocksParser().parse(url)
      case 'vmess':
        return new VmessParser().parse(url)
      case 'vless':
        return new VlessParser().parse(url)
      case 'hysteria':
      case 'hysteria2':
      case 'hy2':
        return new Hysteria2Parser().parse(url)
      case 'trojan':
        return new TrojanParser().parse(url)
      case 'tuic':
        return new TuicParser().parse(url)
      default:
        return null
    }
  }

  static async parseSubscription(
    input: string,
    userAgent: string = 'curl/7.74.0'
  ): Promise<ProxyConfig[]> {
    const lines = input.split('\n')
    const proxies: ProxyConfig[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      // Check if it's a URL (http/https subscription link)
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        try {
          const response = await fetch(trimmed, {
            headers: { 'User-Agent': userAgent },
          })
          const text = await response.text()
          let decodedText = decodeBase64(text.trim())

          // Check if needs URL decoding
          if (decodedText.includes('%')) {
            decodedText = decodeURIComponent(decodedText)
          }

          const subProxies = decodedText.split('\n')
          for (const subLine of subProxies) {
            const proxy = ProxyParser.parse(subLine.trim())
            if (proxy) proxies.push(proxy)
          }
        } catch (e) {
          console.warn('Failed to fetch subscription:', e)
        }
      } else {
        // Direct proxy link
        const proxy = ProxyParser.parse(trimmed)
        if (proxy) proxies.push(proxy)
      }
    }

    return proxies
  }
}

class ShadowsocksParser {
  parse(url: string): ProxyConfig | null {
    const parts = url.replace('ss://', '').split('#')
    const mainPart = parts[0]
    let tag = parts[1] || 'Shadowsocks'

    if (tag && tag.includes('%')) {
      tag = decodeURIComponent(tag)
    }

    try {
      const [base64, serverPart] = mainPart.split('@')

      // If no @ symbol found, try legacy format
      if (!serverPart) {
        const decodedLegacy = base64ToBinary(mainPart)
        const [methodAndPass, serverInfo] = decodedLegacy.split('@')
        const [method, password] = methodAndPass.split(':')
        const { server, port } = parseServerInfo(serverInfo)

        return this.createConfig(tag, server, port, method, password)
      }

      // New format parsing
      const decodedParts = base64ToBinary(decodeURIComponent(base64)).split(':')
      const method = decodedParts[0]
      const password = decodedParts.slice(1).join(':')
      const { server, port } = parseServerInfo(serverPart)

      return this.createConfig(tag, server, port, method, password)
    } catch (e) {
      console.error('Failed to parse shadowsocks URL:', e)
      return null
    }
  }

  private createConfig(
    tag: string,
    server: string,
    port: number,
    method: string,
    password: string
  ): ProxyConfig {
    return {
      tag,
      type: 'shadowsocks',
      server,
      server_port: port,
      method,
      password,
      network: 'tcp',
      tcp_fast_open: false,
    }
  }
}

class VmessParser {
  parse(url: string): ProxyConfig | null {
    try {
      const base64 = url.replace('vmess://', '')
      const vmessConfig = JSON.parse(decodeBase64(base64))

      let tls: any = { enabled: false }
      let transport: any = {}

      if (vmessConfig.net === 'ws') {
        transport = {
          type: 'ws',
          path: vmessConfig.path || '/',
          headers: {
            Host: vmessConfig.host || vmessConfig.sni || '',
          },
        }
        if (vmessConfig.tls !== '') {
          tls = {
            enabled: true,
            server_name: vmessConfig.sni || vmessConfig.host || '',
            insecure: vmessConfig.skip_cert_verify === 1,
          }
        }
      } else if (vmessConfig.net === 'grpc') {
        transport = {
          type: 'grpc',
          service_name: vmessConfig.path || vmessConfig.serviceName || '',
        }
        if (vmessConfig.tls !== '') {
          tls = {
            enabled: true,
            server_name: vmessConfig.sni || vmessConfig.host || '',
            insecure: vmessConfig.skip_cert_verify === 1,
          }
        }
      }

      return {
        tag: vmessConfig.ps || vmessConfig.add || 'VMess',
        type: 'vmess',
        server: vmessConfig.add,
        server_port: parseInt(vmessConfig.port),
        uuid: vmessConfig.id,
        alter_id: parseInt(vmessConfig.aid) || 0,
        security: vmessConfig.scy || 'auto',
        tls,
        transport,
      }
    } catch (e) {
      console.error('Failed to parse vmess URL:', e)
      return null
    }
  }
}

class VlessParser {
  parse(url: string): ProxyConfig | null {
    try {
      const urlObj = new URL(url)
      const uuid = urlObj.username
      const server = urlObj.hostname
      const port = parseInt(urlObj.port)
      const params = parseUrlParams(url)
      const tag = decodeURIComponent(urlObj.hash.slice(1)) || 'VLESS'

      const config: ProxyConfig = {
        tag,
        type: 'vless',
        server,
        server_port: port,
        uuid,
        tls: createTlsConfig(params),
        transport: createTransportConfig(params.type || 'tcp', params),
      }

      return config
    } catch (e) {
      console.error('Failed to parse vless URL:', e)
      return null
    }
  }
}

class Hysteria2Parser {
  parse(url: string): ProxyConfig | null {
    try {
      const urlObj = new URL(url)
      const password = urlObj.username
      const server = urlObj.hostname
      const port = parseInt(urlObj.port)
      // const params = parseUrlParams(url)
      const tag = decodeURIComponent(urlObj.hash.slice(1)) || 'Hysteria2'

      return {
        tag,
        type: 'hysteria2',
        server,
        server_port: port,
        password,
        tls: true,
      }
    } catch (e) {
      console.error('Failed to parse hysteria2 URL:', e)
      return null
    }
  }
}

class TrojanParser {
  parse(url: string): ProxyConfig | null {
    try {
      const urlObj = new URL(url)
      const password = urlObj.username
      const server = urlObj.hostname
      const port = parseInt(urlObj.port)
      const params = parseUrlParams(url)
      const tag = decodeURIComponent(urlObj.hash.slice(1)) || 'Trojan'

      return {
        tag,
        type: 'trojan',
        server,
        server_port: port,
        password,
        tls: createTlsConfig(params),
        transport: createTransportConfig(params.type || 'tcp', params),
      }
    } catch (e) {
      console.error('Failed to parse trojan URL:', e)
      return null
    }
  }
}

class TuicParser {
  parse(url: string): ProxyConfig | null {
    try {
      const urlObj = new URL(url)
      const [uuid, password] = urlObj.username.split(':')
      const server = urlObj.hostname
      const port = parseInt(urlObj.port)
      // const params = parseUrlParams(url)
      const tag = decodeURIComponent(urlObj.hash.slice(1)) || 'TUIC'

      return {
        tag,
        type: 'tuic',
        server,
        server_port: port,
        uuid,
        password,
        tls: true,
      }
    } catch (e) {
      console.error('Failed to parse tuic URL:', e)
      return null
    }
  }
}
