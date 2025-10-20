import type { ProxyConfig, ClashProxy, ClashConfig, CustomRule } from './types'
import { deepCopy } from './utils'

const DEFAULT_CLASH_CONFIG: Partial<ClashConfig> = {
  'mixed-port': 7890,
  'allow-lan': false,
  mode: 'rule',
  'log-level': 'info',
  'external-controller': '127.0.0.1:9090',
  dns: {
    enable: true,
    listen: '0.0.0.0:53',
    'enhanced-mode': 'fake-ip',
    'fake-ip-range': '198.18.0.1/16',
    nameserver: ['223.5.5.5', '119.29.29.29'],
    fallback: ['8.8.8.8', '1.1.1.1'],
  },
}

const PREDEFINED_RULES: Record<string, string[]> = {
  minimal: [
    'DOMAIN-SUFFIX,google.com,PROXY',
    'DOMAIN-SUFFIX,youtube.com,PROXY',
    'DOMAIN-SUFFIX,facebook.com,PROXY',
    'DOMAIN-SUFFIX,twitter.com,PROXY',
    'GEOIP,CN,DIRECT',
    'MATCH,PROXY',
  ],
  balanced: [
    'DOMAIN-SUFFIX,google.com,PROXY',
    'DOMAIN-SUFFIX,googleapis.com,PROXY',
    'DOMAIN-SUFFIX,youtube.com,PROXY',
    'DOMAIN-SUFFIX,facebook.com,PROXY',
    'DOMAIN-SUFFIX,twitter.com,PROXY',
    'DOMAIN-SUFFIX,telegram.org,PROXY',
    'DOMAIN-SUFFIX,github.com,PROXY',
    'DOMAIN-SUFFIX,githubusercontent.com,PROXY',
    'DOMAIN-KEYWORD,google,PROXY',
    'GEOIP,CN,DIRECT',
    'MATCH,PROXY',
  ],
  comprehensive: [
    'DOMAIN-SUFFIX,google.com,PROXY',
    'DOMAIN-SUFFIX,googleapis.com,PROXY',
    'DOMAIN-SUFFIX,googleusercontent.com,PROXY',
    'DOMAIN-SUFFIX,youtube.com,PROXY',
    'DOMAIN-SUFFIX,ytimg.com,PROXY',
    'DOMAIN-SUFFIX,facebook.com,PROXY',
    'DOMAIN-SUFFIX,fbcdn.net,PROXY',
    'DOMAIN-SUFFIX,twitter.com,PROXY',
    'DOMAIN-SUFFIX,twimg.com,PROXY',
    'DOMAIN-SUFFIX,telegram.org,PROXY',
    'DOMAIN-SUFFIX,github.com,PROXY',
    'DOMAIN-SUFFIX,githubusercontent.com,PROXY',
    'DOMAIN-SUFFIX,netflix.com,PROXY',
    'DOMAIN-SUFFIX,openai.com,PROXY',
    'DOMAIN-KEYWORD,google,PROXY',
    'DOMAIN-KEYWORD,youtube,PROXY',
    'DOMAIN-KEYWORD,facebook,PROXY',
    'GEOIP,CN,DIRECT',
    'MATCH,PROXY',
  ],
}

export class ClashConfigBuilder {
  private proxies: ClashProxy[] = []
  private config: Partial<ClashConfig>

  constructor(
    private proxyConfigs: ProxyConfig[],
    private selectedRuleSet: keyof typeof PREDEFINED_RULES = 'balanced',
    private customRules: CustomRule[] = [],
    private categoryRules: string[] = []
  ) {
    this.config = deepCopy(DEFAULT_CLASH_CONFIG)
  }

  build(): string {
    this.convertProxies()
    this.buildProxyGroups()
    this.buildRules()

    const config: ClashConfig = {
      ...this.config,
      proxies: this.proxies,
    } as ClashConfig

    // Convert to YAML format (simple implementation)
    return this.toYAML(config)
  }

  private convertProxies(): void {
    this.proxies = this.proxyConfigs
      .map((proxy) => this.convertProxy(proxy))
      .filter((p): p is ClashProxy => p !== null)
  }

  private convertProxy(proxy: ProxyConfig): ClashProxy | null {
    try {
      switch (proxy.type) {
        case 'shadowsocks':
          return {
            name: proxy.tag,
            type: 'ss',
            server: proxy.server,
            port: proxy.server_port,
            cipher: proxy.method || 'aes-256-gcm',
            password: proxy.password || '',
          }

        case 'vmess':
          return {
            name: proxy.tag,
            type: 'vmess',
            server: proxy.server,
            port: proxy.server_port,
            uuid: proxy.uuid || '',
            alterId: proxy.alter_id || 0,
            cipher: proxy.security || 'auto',
            tls: proxy.tls?.enabled || false,
            servername: proxy.tls?.server_name || '',
            'skip-cert-verify': proxy.tls?.insecure || false,
            network: proxy.transport?.type || 'tcp',
            'ws-opts':
              proxy.transport?.type === 'ws'
                ? {
                    path: proxy.transport.path || '/',
                    headers: proxy.transport.headers || {},
                  }
                : undefined,
          }

        case 'vless':
          return {
            name: proxy.tag,
            type: 'vless',
            server: proxy.server,
            port: proxy.server_port,
            uuid: proxy.uuid || '',
            cipher: proxy.security,
            tls: proxy.tls?.enabled || false,
            servername: proxy.tls?.server_name || '',
            network: proxy.transport?.type || 'tcp',
            'ws-opts':
              proxy.transport?.type === 'ws'
                ? {
                    path: proxy.transport.path,
                    headers: proxy.transport.headers,
                  }
                : undefined,
            'grpc-opts':
              proxy.transport?.type === 'grpc'
                ? {
                    'grpc-service-name': proxy.transport.service_name,
                  }
                : undefined,
            'skip-cert-verify': proxy.tls?.insecure || false,
          }

        case 'hysteria2':
          return {
            name: proxy.tag,
            type: 'hysteria2',
            server: proxy.server,
            port: proxy.server_port,
            password: proxy.password || '',
            sni: proxy.tls?.server_name || '',
            'skip-cert-verify': proxy.tls?.insecure || true,
          }

        case 'trojan':
          return {
            name: proxy.tag,
            type: 'trojan',
            server: proxy.server,
            port: proxy.server_port,
            password: proxy.password || '',
            cipher: proxy.security,
            tls: proxy.tls?.enabled || false,
            sni: proxy.tls?.server_name || '',
            network: proxy.transport?.type || 'tcp',
            'ws-opts':
              proxy.transport?.type === 'ws'
                ? {
                    path: proxy.transport.path,
                    headers: proxy.transport.headers,
                  }
                : undefined,
            'grpc-opts':
              proxy.transport?.type === 'grpc'
                ? {
                    'grpc-service-name': proxy.transport.service_name,
                  }
                : undefined,
            'skip-cert-verify': proxy.tls?.insecure || false,
          }

        case 'tuic':
          return {
            name: proxy.tag,
            type: 'tuic',
            server: proxy.server,
            port: proxy.server_port,
            uuid: proxy.uuid || '',
            password: proxy.password || '',
            'skip-cert-verify': proxy.tls?.insecure || false,
            'disable-sni': true,
            alpn: proxy.tls?.alpn,
            sni: proxy.tls?.server_name,
            'udp-relay-mode': 'native',
          }

        default:
          return null
      }
    } catch (e) {
      console.error('Failed to convert proxy:', e)
      return null
    }
  }

  private buildProxyGroups(): void {
    const proxyNames = this.proxies.map((p) => p.name)
    const groups: any[] = [
      {
        name: 'PROXY',
        type: 'select',
        proxies: ['Auto', 'DIRECT', ...proxyNames],
      },
      {
        name: 'Auto',
        type: 'url-test',
        proxies: proxyNames,
        url: 'http://www.gstatic.com/generate_204',
        interval: 300,
      },
    ]

    // Add custom rule groups
    for (const rule of this.customRules) {
      if (rule.name && !groups.find((g) => g.name === rule.name)) {
        groups.push({
          name: rule.name,
          type: 'select',
          proxies: ['PROXY', 'DIRECT', 'Auto', ...proxyNames],
        })
      }
    }

    this.config['proxy-groups'] = groups
  }

  private buildRules(): void {
    let rules: string[] = []

    // Add custom rules first (higher priority)
    if (this.customRules.length > 0) {
      for (const rule of this.customRules) {
        if (!rule.name) continue

        // GeoSite rules
        if (rule.site) {
          rule.site.split(',').forEach((site) => {
            const trimmed = site.trim()
            if (trimmed) {
              rules.push(`GEOSITE,${trimmed},${rule.name}`)
            }
          })
        }

        // Domain suffix rules
        if (rule.domain_suffix) {
          rule.domain_suffix.split(',').forEach((domain) => {
            const trimmed = domain.trim()
            if (trimmed) {
              rules.push(`DOMAIN-SUFFIX,${trimmed},${rule.name}`)
            }
          })
        }

        // Domain keyword rules
        if (rule.domain_keyword) {
          rule.domain_keyword.split(',').forEach((keyword) => {
            const trimmed = keyword.trim()
            if (trimmed) {
              rules.push(`DOMAIN-KEYWORD,${trimmed},${rule.name}`)
            }
          })
        }

        // GeoIP rules
        if (rule.ip) {
          rule.ip.split(',').forEach((geoip) => {
            const trimmed = geoip.trim().toUpperCase()
            if (trimmed) {
              rules.push(`GEOIP,${trimmed},${rule.name}`)
            }
          })
        }

        // IP-CIDR rules
        if (rule.ip_cidr) {
          rule.ip_cidr.split(',').forEach((cidr) => {
            const trimmed = cidr.trim()
            if (trimmed) {
              rules.push(`IP-CIDR,${trimmed},${rule.name}`)
            }
          })
        }

        // Protocol rules (Clash Meta/Mihomo only)
        if (rule.protocol) {
          rule.protocol.split(',').forEach((protocol) => {
            const trimmed = protocol.trim().toUpperCase()
            if (trimmed) {
              rules.push(`PROTOCOL,${trimmed},${rule.name}`)
            }
          })
        }
      }
    }

    // Add category rules (if custom rule set is selected)
    if (this.categoryRules.length > 0) {
      rules = [...rules, ...this.categoryRules]
    }

    // Add predefined rules (if not custom)
    if (this.selectedRuleSet !== 'custom') {
      if (this.selectedRuleSet in PREDEFINED_RULES) {
        rules = [...rules, ...PREDEFINED_RULES[this.selectedRuleSet]]
      } else {
        rules = [...rules, ...PREDEFINED_RULES.balanced]
      }
    }

    // Ensure there's always a final MATCH rule
    if (!rules.some((r) => r.startsWith('MATCH,'))) {
      rules.push('MATCH,PROXY')
    }

    this.config.rules = rules
  }

  private toYAML(obj: any, indent: number = 0, isArrayItem: boolean = false): string {
    const spaces = '  '.repeat(indent)
    let yaml = ''

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const item = obj[i]
        if (typeof item === 'object' && item !== null) {
          // For objects in arrays, put first property on same line as dash
          const entries = Object.entries(item).filter(([_, v]) => v !== undefined)
          if (entries.length > 0) {
            const [firstKey, firstValue] = entries[0]
            const restEntries = entries.slice(1)

            // First line: - key: value
            if (Array.isArray(firstValue)) {
              yaml += `${spaces}- ${firstKey}:\n${this.toYAML(firstValue, indent + 2)}`
            } else if (typeof firstValue === 'object' && firstValue !== null) {
              yaml += `${spaces}- ${firstKey}:\n${this.toYAML(firstValue, indent + 2)}`
            } else {
              yaml += `${spaces}- ${firstKey}: ${this.formatValue(firstValue)}\n`
            }

            // Rest of the properties
            for (const [key, value] of restEntries) {
              if (Array.isArray(value)) {
                yaml += `${spaces}  ${key}:\n${this.toYAML(value, indent + 2)}`
              } else if (typeof value === 'object' && value !== null) {
                yaml += `${spaces}  ${key}:\n${this.toYAML(value, indent + 2)}`
              } else {
                yaml += `${spaces}  ${key}: ${this.formatValue(value)}\n`
              }
            }
          }
        } else {
          yaml += `${spaces}- ${this.formatValue(item)}\n`
        }
      }
    } else if (typeof obj === 'object' && obj !== null) {
      for (const [key, value] of Object.entries(obj)) {
        if (value === undefined) continue

        if (Array.isArray(value)) {
          yaml += `${spaces}${key}:\n${this.toYAML(value, indent + 1)}`
        } else if (typeof value === 'object' && value !== null) {
          yaml += `${spaces}${key}:\n${this.toYAML(value, indent + 1)}`
        } else {
          yaml += `${spaces}${key}: ${this.formatValue(value)}\n`
        }
      }
    }

    return yaml
  }

  private formatValue(value: any): string {
    if (typeof value === 'string') {
      // Quote strings that contain special characters
      if (
        value.includes(':') ||
        value.includes('#') ||
        value.includes('[') ||
        value.includes(']')
      ) {
        return `"${value}"`
      }
      return value
    }
    return String(value)
  }
}
