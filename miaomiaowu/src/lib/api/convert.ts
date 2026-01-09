import { api } from '../api'

export interface ConvertOptions {
  include_unsupported?: boolean
  client_compatibility?: boolean
  use_new_template_system?: boolean
  enable_proxy_provider?: boolean
}

export interface ConvertRequest {
  proxies: Record<string, any>[]
  target: string
  options?: ConvertOptions
}

export interface ConvertResponse {
  content: string
  count: number
}

/**
 * 将节点列表转换为指定格式的配置
 * @param proxies 节点列表
 * @param target 目标格式: clash, clashmeta, surge, shadowrocket, uri, sing-box 等
 * @param options 转换选项
 * @returns 转换后的配置内容
 */
export async function convertProxies(
  proxies: Record<string, any>[],
  target: string,
  options?: ConvertOptions
): Promise<ConvertResponse> {
  const response = await api.post<ConvertResponse>('/api/convert', {
    proxies,
    target,
    options: options || {}
  })
  return response.data
}

/**
 * 将单个节点转换为 URI 格式
 * @param proxy 节点对象
 * @returns URI 字符串
 */
export async function convertToURI(proxy: Record<string, any>): Promise<string> {
  const result = await convertProxies([proxy], 'uri')
  return result.content.trim()
}

/**
 * 批量将节点转换为 URI 格式
 * @param proxies 节点列表
 * @returns URI 字符串数组（每行一个）
 */
export async function convertToURIs(proxies: Record<string, any>[]): Promise<string[]> {
  const result = await convertProxies(proxies, 'uri')
  return result.content.split('\n').filter(line => line.trim())
}
