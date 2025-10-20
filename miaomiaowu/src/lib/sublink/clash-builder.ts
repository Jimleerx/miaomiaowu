import type { ProxyConfig, CustomRule } from './types'
import { deepCopy } from './utils'
import { DEFAULT_CLASH_CONFIG, CLASH_SITE_RULE_SET_BASE_URL, CLASH_IP_RULE_SET_BASE_URL } from './clash-config'
import { RULE_CATEGORIES } from './predefined-rules'
import { translateOutbound, CATEGORY_TO_RULE_NAME } from './translations'
import { ProxyNode } from '../proxy-parser'

export class ClashConfigBuilder {
  private proxies: ProxyNode[] = []
  private config: any

  constructor(
    private proxyConfigs: ProxyConfig[],
    private selectedCategories: string[] = [],
    private customRules: CustomRule[] = []
  ) {
    this.config = deepCopy(DEFAULT_CLASH_CONFIG)
  }

  build(): string {
    this.convertProxies()
    this.buildRuleProviders()
    this.buildProxyGroups()
    this.buildRules()

    // Convert to YAML
    return this.toYAML(this.config)
  }

  private convertProxies(): void {
    this.config.proxies = this.proxyConfigs
  }
  private buildRuleProviders(): void {
    const ruleProviders: any = {}
    const siteRules = new Set<string>()
    const ipRules = new Set<string>()

    // Collect rules from selected categories
    for (const categoryName of this.selectedCategories) {
      const category = RULE_CATEGORIES.find((c) => c.name === categoryName)
      if (!category) continue

      category.site_rules.forEach((rule) => siteRules.add(rule))
      category.ip_rules.forEach((rule) => ipRules.add(rule))
    }

    // Build site rule providers
    siteRules.forEach((rule) => {
      ruleProviders[rule] = {
        type: 'http',
        format: 'mrs',
        behavior: 'domain',
        url: `${CLASH_SITE_RULE_SET_BASE_URL}${rule}.mrs`,
        path: `./ruleset/${rule}.mrs`,
        interval: 86400,
      }
    })

    // Build IP rule providers
    ipRules.forEach((rule) => {
      ruleProviders[rule] = {
        type: 'http',
        format: 'mrs',
        behavior: 'ipcidr',
        url: `${CLASH_IP_RULE_SET_BASE_URL}${rule}.mrs`,
        path: `./ruleset/${rule}.mrs`,
        interval: 86400,
      }
    })

    this.config['rule-providers'] = ruleProviders
  }

  private buildProxyGroups(): void {
    const proxyNames = this.proxies.map((p) => p.name)
    const groups: any[] = []

    // 1. Node Select group
    groups.push({
      name: translateOutbound('Node Select'),
      type: 'select',
      proxies: ['DIRECT', 'REJECT', translateOutbound('Auto Select'), ...proxyNames],
    })

    // 2. Auto Select group
    groups.push({
      name: translateOutbound('Auto Select'),
      type: 'url-test',
      proxies: proxyNames,
      url: 'https://www.gstatic.com/generate_204',
      interval: 300,
      lazy: false,
    })

    // 3. Category-specific groups
    for (const categoryName of this.selectedCategories) {
      const ruleName = CATEGORY_TO_RULE_NAME[categoryName]
      if (!ruleName) continue

      groups.push({
        name: translateOutbound(ruleName),
        type: 'select',
        proxies: [
          translateOutbound('Node Select'),
          'DIRECT',
          'REJECT',
          translateOutbound('Auto Select'),
          ...proxyNames,
        ],
      })
    }

    // 4. Custom rule groups
    for (const rule of this.customRules) {
      if (!rule.name) continue

      groups.push({
        name: translateOutbound(rule.name),
        type: 'select',
        proxies: [
          translateOutbound('Node Select'),
          'DIRECT',
          'REJECT',
          translateOutbound('Auto Select'),
          ...proxyNames,
        ],
      })
    }

    // 5. Fall Back group
    groups.push({
      name: translateOutbound('Fall Back'),
      type: 'select',
      proxies: [
        translateOutbound('Node Select'),
        'DIRECT',
        'REJECT',
        translateOutbound('Auto Select'),
        ...proxyNames,
      ],
    })

    this.config['proxy-groups'] = groups
  }

  private buildRules(): void {
    const rules: string[] = []

    // Custom rules first (domain-based)
    for (const rule of this.customRules) {
      if (!rule.name) continue

      const outbound = translateOutbound(rule.name)

      if (rule.domain_suffix) {
        rule.domain_suffix.split(',').forEach((domain) => {
          const trimmed = domain.trim()
          if (trimmed) rules.push(`DOMAIN-SUFFIX,${trimmed},${outbound}`)
        })
      }

      if (rule.domain_keyword) {
        rule.domain_keyword.split(',').forEach((keyword) => {
          const trimmed = keyword.trim()
          if (trimmed) rules.push(`DOMAIN-KEYWORD,${trimmed},${outbound}`)
        })
      }
    }

    // Category rules (RULE-SET format)
    for (const categoryName of this.selectedCategories) {
      const category = RULE_CATEGORIES.find((c) => c.name === categoryName)
      if (!category) continue

      const ruleName = CATEGORY_TO_RULE_NAME[categoryName]
      if (!ruleName) continue

      const outbound = translateOutbound(ruleName)

      // Site rules
      for (const siteRule of category.site_rules) {
        rules.push(`RULE-SET,${siteRule},${outbound}`)
      }
    }

    // Custom rules (IP-based) after site rules
    for (const rule of this.customRules) {
      if (!rule.name) continue

      const outbound = translateOutbound(rule.name)

      if (rule.ip_cidr) {
        rule.ip_cidr.split(',').forEach((cidr) => {
          const trimmed = cidr.trim()
          if (trimmed) rules.push(`IP-CIDR,${trimmed},${outbound},no-resolve`)
        })
      }
    }

    // Category IP rules
    for (const categoryName of this.selectedCategories) {
      const category = RULE_CATEGORIES.find((c) => c.name === categoryName)
      if (!category) continue

      const ruleName = CATEGORY_TO_RULE_NAME[categoryName]
      if (!ruleName) continue

      const outbound = translateOutbound(ruleName)

      // IP rules
      for (const ipRule of category.ip_rules) {
        rules.push(`RULE-SET,${ipRule},${outbound},no-resolve`)
      }
    }

    // Final MATCH rule
    rules.push(`MATCH,${translateOutbound('Fall Back')}`)

    this.config.rules = rules
  }

  private toYAML(obj: any, indent: number = 0): string {
    const spaces = '  '.repeat(indent)
    let yaml = ''

    if (Array.isArray(obj)) {
      for (const item of obj) {
        if (typeof item === 'object' && item !== null) {
          const entries = Object.entries(item).filter(([_, v]) => v !== undefined)
          if (entries.length > 0) {
            const [firstKey, firstValue] = entries[0]
            const restEntries = entries.slice(1)

            if (Array.isArray(firstValue)) {
              yaml += `${spaces}- ${firstKey}:\n${this.toYAML(firstValue, indent + 2)}`
            } else if (typeof firstValue === 'object' && firstValue !== null) {
              yaml += `${spaces}- ${firstKey}:\n${this.toYAML(firstValue, indent + 2)}`
            } else {
              yaml += `${spaces}- ${firstKey}: ${this.formatValue(firstValue)}\n`
            }

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
      if (
        value.includes(':') ||
        value.includes('#') ||
        value.includes('[') ||
        value.includes(']') ||
        value.includes(',')
      ) {
        return `"${value}"`
      }
      return value
    }
    return String(value)
  }
}
