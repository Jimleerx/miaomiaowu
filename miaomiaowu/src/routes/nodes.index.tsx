// @ts-nocheck
import { useState, useMemo } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Topbar } from '@/components/layout/topbar'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { parseProxyUrl, toClashProxy, type ProxyNode, type ClashProxy } from '@/lib/proxy-parser'
import { Check, Pencil, X, Undo2, Activity, Eye } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import IpIcon from '@/assets/icons/ip.svg'

// @ts-ignore - retained simple route definition
export const Route = createFileRoute('/nodes/')({
  beforeLoad: () => {
    const token = useAuthStore.getState().auth.accessToken
    if (!token) {
      throw redirect({ to: '/' })
    }
  },
  component: NodesPage,
})

type ParsedNode = {
  id: number
  raw_url: string
  node_name: string
  protocol: string
  parsed_config: string
  clash_config: string
  enabled: boolean
  tag: string
  original_server: string
  probe_server: string
  created_at: string
  updated_at: string
}

type TempNode = {
  id: string
  rawUrl: string
  name: string
  parsed: ProxyNode | null
  clash: ClashProxy | null
  enabled: boolean
  originalServer?: string // 保存原始服务器地址，用于回退
  tag?: string
  isSaved?: boolean
  dbId?: number
  dbNode?: ParsedNode
}

const PROTOCOL_COLORS: Record<string, string> = {
  vmess: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  vless: 'bg-purple-500/10 text-purple-700 dark:text-purple-400',
  trojan: 'bg-red-500/10 text-red-700 dark:text-red-400',
  ss: 'bg-green-500/10 text-green-700 dark:text-green-400',
  socks5: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  hysteria: 'bg-pink-500/10 text-pink-700 dark:text-pink-400',
  hysteria2: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400',
  tuic: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400',
}

const PROTOCOLS = ['vmess', 'vless', 'trojan', 'ss', 'socks5', 'hysteria', 'hysteria2', 'tuic']

// 检查是否是IP地址（IPv4或IPv6）
function isIpAddress(hostname: string): boolean {
  if (!hostname) return false

  // 去除IPv6地址的方括号（如 [2a03:4000:6:d221::1]）
  const cleanHostname = hostname.replace(/^\[|\]$/g, '')

  // IPv4正则
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
  // IPv6正则（简化版，匹配标准IPv6格式）
  const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/

  return ipv4Regex.test(cleanHostname) || ipv6Regex.test(cleanHostname)
}

function NodesPage() {
  const { auth } = useAuthStore()
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [subscriptionUrl, setSubscriptionUrl] = useState('')
  const [tempNodes, setTempNodes] = useState<TempNode[]>([])
  const [selectedProtocol, setSelectedProtocol] = useState<string>('all')
  const [currentTag, setCurrentTag] = useState<string>('manual') // 'manual' 或 'subscription'
  const [tagFilter, setTagFilter] = useState<string>('all')
  const [editingNode, setEditingNode] = useState<{ id: string; value: string } | null>(null)
  const [resolvingIpFor, setResolvingIpFor] = useState<string | null>(null) // 正在解析IP的节点ID
  const [ipMenuState, setIpMenuState] = useState<{ nodeId: string; ips: string[] } | null>(null) // IP选择菜单状态
  const [probeBindingDialogOpen, setProbeBindingDialogOpen] = useState(false)
  const [selectedNodeForProbe, setSelectedNodeForProbe] = useState<ParsedNode | null>(null)

  // 获取用户配置
  const { data: userConfig } = useQuery({
    queryKey: ['user-config'],
    queryFn: async () => {
      const response = await api.get('/api/user/config')
      return response.data as {
        force_sync_external: boolean
        match_rule: string
        cache_expire_minutes: number
        sync_traffic: boolean
        enable_probe_binding: boolean
      }
    },
    enabled: Boolean(auth.accessToken),
  })

  // 获取探针服务器列表
  const { data: probeConfigResponse, refetch: refetchProbeConfig } = useQuery({
    queryKey: ['probe-config'],
    queryFn: async () => {
      const response = await api.get('/api/admin/probe-config')
      return response.data as {
        config: {
          probe_type: string
          address: string
          servers: Array<{ id: number; name: string; server_id: string }>
        }
      }
    },
    enabled: false, // 手动触发，不自动执行
  })

  const probeConfig = probeConfigResponse?.config

  // 获取已保存的节点
  const { data: nodesData } = useQuery({
    queryKey: ['nodes'],
    queryFn: async () => {
      const response = await api.get('/api/admin/nodes')
      return response.data as { nodes: ParsedNode[] }
    },
    enabled: Boolean(auth.accessToken),
  })

  const savedNodes = useMemo(() => nodesData?.nodes ?? [], [nodesData?.nodes])

  const updateConfigName = (config, name) => {
    if (!config) return config
    try {
      const parsed = JSON.parse(config)
      if (parsed && typeof parsed === 'object') {
        parsed.name = name
      }
      return JSON.stringify(parsed)
    } catch (error) {
      return config
    }
  }

  const cloneProxyWithName = (proxy, name) => {
    if (!proxy || typeof proxy !== 'object') {
      return proxy
    }
    return {
      ...proxy,
      name,
    }
  }

  const updateNodeNameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      const target = savedNodes.find(n => n.id === id)
      if (!target) {
        throw new Error('未找到节点?')
      }
      const updatedParsedConfig = updateConfigName(target.parsed_config, name)
      const updatedClashConfig = updateConfigName(target.clash_config, name)
      const response = await api.put(`/api/admin/nodes/${id}`, {
        raw_url: target.raw_url,
        node_name: name,
        protocol: target.protocol,
        parsed_config: updatedParsedConfig,
        clash_config: updatedClashConfig,
        enabled: target.enabled,
        tag: target.tag,
      })
      return response.data
    },
    onSuccess: () => {
      toast.success('节点名称已更新')
      setEditingNode(null)
      queryClient.invalidateQueries({ queryKey: ['nodes'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '节点名称更新失败')
    },
  })

  // DNS解析IP地址
  const resolveIpMutation = useMutation({
    mutationFn: async (hostname: string) => {
      const response = await api.get(`/api/dns/resolve?hostname=${encodeURIComponent(hostname)}`)
      return response.data as { ips: string[] }
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'IP解析失败')
      setResolvingIpFor(null)
    },
  })

  // 更新节点服务器地址
  const updateNodeServerMutation = useMutation({
    mutationFn: async (payload: { nodeId: number; server: string }) => {
      const response = await api.put(`/api/admin/nodes/${payload.nodeId}/server`, { server: payload.server })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] })
      toast.success('服务器地址已更新')
      setResolvingIpFor(null)
      setIpMenuState(null)
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '服务器地址更新失败')
      setResolvingIpFor(null)
    },
  })

  // 恢复节点原始域名
  const restoreNodeServerMutation = useMutation({
    mutationFn: async (nodeId: number) => {
      const response = await api.put(`/api/admin/nodes/${nodeId}/restore-server`)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] })
      toast.success('已恢复原始域名')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '恢复原始域名失败')
    },
  })

  // 更新节点探针绑定
  const updateProbeBindingMutation = useMutation({
    mutationFn: async (payload: { nodeId: number; probeServer: string }) => {
      const response = await api.put(`/api/admin/nodes/${payload.nodeId}/probe-binding`, {
        probe_server: payload.probeServer
      })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] })
      toast.success('探针绑定已更新')
      setProbeBindingDialogOpen(false)
      setSelectedNodeForProbe(null)
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '探针绑定更新失败')
    },
  })

  // 处理IP解析
  const handleResolveIp = async (node: TempNode) => {
    if (!node.parsed?.server) return

    const nodeKey = node.isSaved ? String(node.dbId) : node.id
    setResolvingIpFor(nodeKey)

    try {
      const result = await resolveIpMutation.mutateAsync(node.parsed.server)

      if (result.ips.length === 0) {
        toast.error('未解析到IP地址')
        setResolvingIpFor(null)
        return
      }

      if (result.ips.length === 1) {
        // 只有一个IP，直接更新
        if (node.isSaved && node.dbId) {
          // 已保存的节点，调用API更新
          updateNodeServerMutation.mutate({
            nodeId: node.dbId,
            server: result.ips[0],
          })
        } else {
          // 未保存的节点，更新临时节点列表
          updateTempNodeServer(node.id, result.ips[0])
          setResolvingIpFor(null)
        }
      } else {
        // 多个IP，显示菜单让用户选择
        setIpMenuState({ nodeId: nodeKey, ips: result.ips })
        setResolvingIpFor(null)
      }
    } catch (error) {
      // Error already handled by mutation
    }
  }

  // 更新临时节点的服务器地址
  const updateTempNodeServer = (nodeId: string, server: string) => {
    setTempNodes(prev => prev.map(n => {
      if (n.id !== nodeId) return n

      // 如果还没有保存原始服务器地址，则保存当前的
      const originalServer = n.originalServer || n.parsed?.server

      // 更新 parsed 配置
      const updatedParsed = n.parsed ? { ...n.parsed, server } : n.parsed

      // 更新 clash 配置
      const updatedClash = n.clash ? { ...n.clash, server } : n.clash

      return {
        ...n,
        parsed: updatedParsed,
        clash: updatedClash,
        originalServer,
      }
    }))
    toast.success('服务器地址已更新')
  }

  // 恢复临时节点的原始服务器地址
  const restoreTempNodeServer = (nodeId: string) => {
    setTempNodes(prev => prev.map(n => {
      if (n.id !== nodeId || !n.originalServer) return n

      // 恢复到原始服务器地址
      const updatedParsed = n.parsed ? { ...n.parsed, server: n.originalServer } : n.parsed
      const updatedClash = n.clash ? { ...n.clash, server: n.originalServer } : n.clash

      return {
        ...n,
        parsed: updatedParsed,
        clash: updatedClash,
        originalServer: undefined, // 清除原始服务器地址标记
      }
    }))
    toast.success('已恢复原始服务器地址')
  }

  // 批量创建节点
  const batchCreateMutation = useMutation({
    mutationFn: async (nodes: TempNode[]) => {
      const tag = currentTag === 'manual' ? '手动输入' : '订阅导入'

      const payload = nodes.map(n => ({
        raw_url: n.rawUrl,
        node_name: n.name || '未知',
        protocol: n.parsed?.type || 'unknown',
        parsed_config: n.parsed ? JSON.stringify(cloneProxyWithName(n.parsed, n.name)) : '',
        clash_config: n.clash ? JSON.stringify(cloneProxyWithName(n.clash, n.name)) : '',
        enabled: n.enabled,
        tag: tag,
      }))

      const response = await api.post('/api/admin/nodes/batch', { nodes: payload })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] })
      toast.success('节点保存成功')
      setInput('')
      setTempNodes([])
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '保存失败')
    },
  })

  // 切换节点启用状态
  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) => {
      const node = savedNodes.find(n => n.id === id)
      if (!node) return

      const response = await api.put(`/api/admin/nodes/${id}`, {
        raw_url: node.raw_url,
        node_name: node.node_name,
        protocol: node.protocol,
        parsed_config: node.parsed_config,
        clash_config: node.clash_config,
        enabled,
      })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '更新失败')
    },
  })

  // 删除节点
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/admin/nodes/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] })
      toast.success('节点已删除')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '删除失败')
    },
  })

  // 清空所有节点
  const clearAllMutation = useMutation({
    mutationFn: async () => {
      await api.post('/api/admin/nodes/clear')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] })
      toast.success('所有节点已清空')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '清空失败')
    },
  })

  // 从订阅获取节点
  const fetchSubscriptionMutation = useMutation({
    mutationFn: async (url: string) => {
      const response = await api.post('/api/admin/nodes/fetch-subscription', { url })
      return response.data as { proxies: ClashProxy[]; count: number }
    },
    onSuccess: async (data, url) => {
      // 将Clash节点转换为TempNode格式
      const parsed: TempNode[] = data.proxies.map((clashNode) => {
        // Clash节点已经是标准格式，直接作为ProxyNode和ClashProxy使用
        const proxyNode: ProxyNode = {
          name: clashNode.name || '未知',
          type: clashNode.type || 'unknown',
          server: clashNode.server || '',
          port: clashNode.port || 0,
          ...clashNode,
        }
        const name = proxyNode.name || '未知'
        const parsedProxy = cloneProxyWithName(proxyNode, name)
        const clashProxy = cloneProxyWithName(clashNode, name)

        return {
          id: Math.random().toString(36).substring(7),
          rawUrl: '', // Clash订阅的节点没有原始URL
          name,
          parsed: parsedProxy,
          clash: clashProxy,
          enabled: true,
        }
      })

      setTempNodes(parsed)
      setCurrentTag('subscription') // 订阅导入
      toast.success(`成功导入 ${data.count} 个节点`)

      // 保存外部订阅链接
      try {
        // 从 URL 中提取名称（使用域名或者最后一部分）
        const urlObj = new URL(url)
        const name = urlObj.hostname || '外部订阅'

        await api.post('/api/user/external-subscriptions', {
          name: name,
          url: url,
        })
      } catch (error) {
        // 如果保存失败（比如已经存在），忽略错误
        console.log('保存外部订阅链接失败（可能已存在）:', error)
      }
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '获取订阅失败')
    },
  })

  const handleParse = () => {
    const lines = input.split('\n').filter(line => line.trim())
    const parsed: TempNode[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.includes('://')) continue

      const parsedNode = parseProxyUrl(trimmed)
      const clashNode = parsedNode ? toClashProxy(parsedNode) : null
       const name = parsedNode?.name || clashNode?.name || '未知'
       const normalizedParsed = cloneProxyWithName(parsedNode, name)
       const normalizedClash = cloneProxyWithName(clashNode, name)

      parsed.push({
        id: Math.random().toString(36).substring(7),
        rawUrl: trimmed,
        name,
        parsed: normalizedParsed,
        clash: normalizedClash,
        enabled: true,
      })
    }

    setTempNodes(parsed)
    setCurrentTag('manual') // 手动输入
  }

  const handleSave = () => {
    if (tempNodes.length === 0) {
      toast.error('没有可保存的节点')
      return
    }
    batchCreateMutation.mutate(tempNodes)
  }

  const handleToggle = (id: number) => {
    const node = savedNodes.find(n => n.id === id)
    if (node) {
      toggleMutation.mutate({ id, enabled: !node.enabled })
    }
  }

  const handleDelete = (id: number) => {
    deleteMutation.mutate(id)
  }

  const handleDeleteTemp = (id: string) => {
    setTempNodes(prev => prev.filter(node => node.id !== id))
    toast.success('已移除临时节点')
  }

  const handleNameEditStart = (node) => {
    setEditingNode({ id: node.id, value: node.name })
  }

  const handleNameEditChange = (value: string) => {
    setEditingNode(prev => (prev ? { ...prev, value } : prev))
  }

  const handleNameEditCancel = () => {
    setEditingNode(null)
  }

  const handleNameEditSubmit = (node) => {
    if (!editingNode) return
    const trimmed = editingNode.value.trim()
    if (!trimmed) {
      toast.error('节点名称不能为空')
      return
    }
    if (trimmed === node.name) {
      setEditingNode(null)
      return
    }

    if (node.isSaved) {
      updateNodeNameMutation.mutate({ id: node.dbId, name: trimmed })
      return
    }

    setTempNodes(prev =>
      prev.map(item => {
        if (item.id !== node.id) return item
        return {
          ...item,
          name: trimmed,
          parsed: cloneProxyWithName(item.parsed, trimmed),
          clash: cloneProxyWithName(item.clash, trimmed),
        }
      }),
    )
    toast.success('已更新临时节点名称')
    setEditingNode(null)
  }

  const handleClearAll = () => {
    clearAllMutation.mutate()
  }

  const handleFetchSubscription = () => {
    if (!subscriptionUrl.trim()) {
      toast.error('请输入订阅链接')
      return
    }
    fetchSubscriptionMutation.mutate(subscriptionUrl)
  }

  // 合并保存的节点和临时节点用于显示
  const displayNodes = useMemo(() => {
    // 将保存的节点转换为显示格式
    const saved = savedNodes.map(n => {
      let parsed: ProxyNode | null = null
      let clash: ClashProxy | null = null
      try {
        if (n.parsed_config) parsed = JSON.parse(n.parsed_config)
        if (n.clash_config) clash = JSON.parse(n.clash_config)
      } catch (e) {
        // 解析失败，保持 null
      }
      const displayName = (n.node_name && n.node_name.trim()) || parsed?.name || '未知'
      const parsedWithName = cloneProxyWithName(parsed, displayName)
      const clashWithName = cloneProxyWithName(clash, displayName)
      return {
        id: n.id.toString(),
        rawUrl: n.raw_url,
        name: displayName,
        parsed: parsedWithName,
        clash: clashWithName,
        enabled: n.enabled,
        tag: n.tag || '手动输入',
        isSaved: true,
        dbId: n.id,
        dbNode: n,
      }
    })

    // 临时节点
    const temp = tempNodes.map(n => ({
      ...n,
      parsed: cloneProxyWithName(n.parsed, n.name),
      clash: cloneProxyWithName(n.clash, n.name),
      isSaved: false,
      dbId: 0,
    }))

    return [...temp, ...saved]
  }, [savedNodes, tempNodes])

  const filteredNodes = useMemo(() => {
    let nodes = displayNodes

    // 按协议筛选
    if (selectedProtocol !== 'all') {
      nodes = nodes.filter(node => node.parsed?.type === selectedProtocol)
    }

    // 按标签筛选
    if (tagFilter !== 'all') {
      nodes = nodes.filter(node => node.tag === tagFilter)
    }

    return nodes
  }, [displayNodes, selectedProtocol, tagFilter])

  const protocolCounts = useMemo(() => {
    const counts: Record<string, number> = { all: displayNodes.length }
    for (const protocol of PROTOCOLS) {
      counts[protocol] = displayNodes.filter(n => n.parsed?.type === protocol).length
    }
    return counts
  }, [displayNodes])

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = { all: displayNodes.length }
    const tags = new Set<string>()
    displayNodes.forEach(node => {
      if (node.tag) {
        tags.add(node.tag)
        counts[node.tag] = (counts[node.tag] || 0) + 1
      }
    })
    return counts
  }, [displayNodes])

  return (
    <div className='min-h-svh bg-background'>
      <Topbar />
      <main className='mx-auto w-full max-w-7xl px-4 py-8 sm:px-6'>
        <section className='space-y-4'>
          <div>
            <h1 className='text-3xl font-semibold tracking-tight'>节点管理</h1>
            <p className='text-muted-foreground mt-2'>
              输入代理节点信息，每行一个节点，支持 VMess、VLESS、Trojan、Shadowsocks、Hysteria、Socks、Shadowsocks、TUIC 协议。
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>节点输入</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue='manual' className='w-full'>
                <TabsList className='grid w-full grid-cols-2'>
                  <TabsTrigger value='manual'>手动输入</TabsTrigger>
                  <TabsTrigger value='subscription'>订阅导入</TabsTrigger>
                </TabsList>

                <TabsContent value='manual' className='space-y-4 mt-4'>
                  <Textarea
                    placeholder={`vmess://eyJwcyI6IuWPsOa5vualviIsImFkZCI6ImV4YW1wbGUuY29tIiwicG9ydCI6IjQ0MyIsImlkIjoidXVpZCIsImFpZCI6IjAiLCJzY3kiOiJhdXRvIiwibmV0Ijoid3MiLCJ0bHMiOiJ0bHMifQ==
vless://uuid@example.com:443?type=ws&security=tls&path=/websocket#VLESS节点
trojan://password@example.com:443?sni=example.com#Trojan节点`}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    className='min-h-[200px] font-mono text-sm'
                  />
                  <div className='flex justify-end gap-2'>
                    <Button onClick={handleParse} disabled={!input.trim()} variant='outline'>
                      解析节点
                    </Button>
                    <Button
                      onClick={handleSave}
                      disabled={tempNodes.length === 0 || batchCreateMutation.isPending}
                    >
                      {batchCreateMutation.isPending ? '保存中...' : '保存节点'}
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value='subscription' className='space-y-4 mt-4'>
                  <div className='space-y-2'>
                    <Input
                      placeholder='https://example.com/api/clash/subscribe?token=xxx'
                      value={subscriptionUrl}
                      onChange={(e) => setSubscriptionUrl(e.target.value)}
                      className='font-mono text-sm'
                    />
                    <p className='text-xs text-muted-foreground'>
                      请输入 Clash 订阅链接，系统将自动获取并解析节点
                    </p>
                  </div>
                  <div className='flex justify-end gap-2'>
                    <Button
                      onClick={handleFetchSubscription}
                      disabled={!subscriptionUrl.trim() || fetchSubscriptionMutation.isPending}
                      variant='outline'
                    >
                      {fetchSubscriptionMutation.isPending ? '导入中...' : '导入节点'}
                    </Button>
                    <Button
                      onClick={handleSave}
                      disabled={tempNodes.length === 0 || batchCreateMutation.isPending}
                    >
                      {batchCreateMutation.isPending ? '保存中...' : '保存节点'}
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {displayNodes.length > 0 && (
            <Card>
              <CardHeader>
                <div className='flex items-center justify-between'>
                  <div>
                    <CardTitle>节点列表 ({filteredNodes.length})</CardTitle>
                  </div>
                  {savedNodes.length > 0 && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant='destructive'
                          size='sm'
                          disabled={clearAllMutation.isPending}
                        >
                          {clearAllMutation.isPending ? '清空中...' : '清空所有'}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>确认清空所有节点</AlertDialogTitle>
                          <AlertDialogDescription>
                            确定要清空所有已保存的节点吗？此操作不可撤销，将删除 {savedNodes.length} 个节点。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>取消</AlertDialogCancel>
                          <AlertDialogAction onClick={handleClearAll}>
                            清空所有
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </CardHeader>
              <CardContent className='space-y-4'>
                {/* 协议筛选按钮 */}
                <div className='space-y-3'>
                  <div>
                    <div className='text-sm font-medium mb-2'>按协议筛选</div>
                    <div className='flex flex-wrap gap-2'>
                      <Button
                        size='sm'
                        variant={selectedProtocol === 'all' ? 'default' : 'outline'}
                        onClick={() => setSelectedProtocol('all')}
                      >
                        全部 ({protocolCounts.all})
                      </Button>
                      {PROTOCOLS.map(protocol => {
                        const count = protocolCounts[protocol] || 0
                        if (count === 0) return null
                        return (
                          <Button
                            key={protocol}
                            size='sm'
                            variant={selectedProtocol === protocol ? 'default' : 'outline'}
                            onClick={() => setSelectedProtocol(protocol)}
                          >
                            {protocol.toUpperCase()} ({count})
                          </Button>
                        )
                      })}
                    </div>
                  </div>

                  {/* 标签筛选按钮 */}
                  <div>
                    <div className='text-sm font-medium mb-2'>按标签筛选</div>
                    <div className='flex flex-wrap gap-2'>
                      <Button
                        size='sm'
                        variant={tagFilter === 'all' ? 'default' : 'outline'}
                        onClick={() => setTagFilter('all')}
                      >
                        全部 ({tagCounts.all})
                      </Button>
                      {Object.keys(tagCounts).filter(tag => tag !== 'all' && tagCounts[tag] > 0).map(tag => (
                        <Button
                          key={tag}
                          size='sm'
                          variant={tagFilter === tag ? 'default' : 'outline'}
                          onClick={() => setTagFilter(tag)}
                        >
                          {tag} ({tagCounts[tag]})
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 节点表格 */}
                <div className='rounded-md border overflow-auto'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className='w-[100px]'>协议</TableHead>
                        <TableHead className='min-w-[150px]'>节点名称</TableHead>
                        <TableHead className='w-[100px]'>标签</TableHead>
                        <TableHead className='min-w-[200px]'>服务器地址</TableHead>
                        <TableHead className='w-[80px] text-center'>配置</TableHead>
                        <TableHead className='w-[100px] text-center'>操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredNodes.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className='text-center text-muted-foreground py-8'>
                            没有找到匹配的节点
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredNodes.map(node => (
                          <TableRow key={node.id}>
                            <TableCell>
                              {node.parsed ? (
                                <Badge
                                  variant='outline'
                                  className={PROTOCOL_COLORS[node.parsed.type] || 'bg-gray-500/10'}
                                >
                                  {node.parsed.type.toUpperCase()}
                                </Badge>
                              ) : (
                                <Badge variant='destructive'>解析失败</Badge>
                              )}
                            </TableCell>
                            <TableCell className='font-medium'>
                              {editingNode?.id === node.id ? (
                                <div className='flex items-center gap-2'>
                                  <Input
                                    value={editingNode.value}
                                    onChange={(event) => handleNameEditChange(event.target.value)}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter') {
                                        event.preventDefault()
                                        handleNameEditSubmit(node)
                                      } else if (event.key === 'Escape') {
                                        event.preventDefault()
                                        handleNameEditCancel()
                                      }
                                    }}
                                    className='h-8 w-48'
                                    autoFocus
                                  />
                                  <Button
                                    variant='ghost'
                                    size='icon'
                                    className='size-8 text-emerald-600'
                                    onClick={() => handleNameEditSubmit(node)}
                                    disabled={node.isSaved ? updateNodeNameMutation.isPending : false}
                                  >
                                    <Check className='size-4' />
                                  </Button>
                                  <Button
                                    variant='ghost'
                                    size='icon'
                                    className='size-8 text-muted-foreground'
                                    onClick={handleNameEditCancel}
                                  >
                                    <X className='size-4' />
                                  </Button>
                                  {node.isSaved && (
                                    <Badge variant='secondary' className='text-xs'>已保存</Badge>
                                  )}
                                </div>
                              ) : (
                                <div className='flex items-center gap-2'>
                                  <span className='truncate max-w-[200px]'>{node.name || '未知'}</span>
                                  {node.isSaved && (
                                    <Badge variant='secondary' className='text-xs'>已保存</Badge>
                                  )}
                                  <Button
                                    variant='ghost'
                                    size='icon'
                                    className='size-7 text-muted-foreground'
                                    onClick={() => handleNameEditStart(node)}
                                    disabled={node.isSaved ? updateNodeNameMutation.isPending : false}
                                  >
                                    <Pencil className='size-4' />
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className='flex flex-wrap gap-1'>
                                {node.isSaved && node.tag && (
                                  <Badge variant='secondary' className='text-xs'>
                                    {node.tag}
                                  </Badge>
                                )}
                                {node.isSaved && node.dbNode?.probe_server && (
                                  <Badge variant='secondary' className='text-xs flex items-center gap-1'>
                                    <Activity className='size-3' />
                                    {node.dbNode.probe_server}
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className='text-sm text-muted-foreground'>
                                {node.parsed ? (
                                  <div className='flex items-center gap-2'>
                                    <div>
                                      <div className='font-mono'>{node.parsed.server}:{node.parsed.port}</div>
                                      {node.parsed.network && node.parsed.network !== 'tcp' && (
                                        <div className='text-xs mt-1'>
                                          <Badge variant='outline' className='text-xs'>
                                            {node.parsed.network}
                                          </Badge>
                                        </div>
                                      )}
                                    </div>
                                    {node.parsed?.server && (
                                      (() => {
                                        const nodeKey = node.isSaved ? String(node.dbId) : node.id
                                        const serverIsIp = isIpAddress(node.parsed.server)
                                        const hasOriginalServer = !node.isSaved && node.originalServer

                                        // 已保存的节点且服务器地址已经是IP，不显示按钮
                                        if (node.isSaved && serverIsIp) {
                                          return null
                                        }

                                        // 未保存的节点且有原始服务器地址，显示回退按钮
                                        if (hasOriginalServer) {
                                          return (
                                            <Button
                                              variant='ghost'
                                              size='sm'
                                              className='size-6 p-0 border border-orange-500/50 hover:border-orange-500'
                                              title='恢复原始域名'
                                              onClick={() => restoreTempNodeServer(node.id)}
                                            >
                                              <Undo2 className='size-4 text-orange-500' />
                                            </Button>
                                          )
                                        }

                                        // 显示IP解析菜单或按钮
                                        return ipMenuState?.nodeId === nodeKey ? (
                                          <DropdownMenu open={true} onOpenChange={(open) => !open && setIpMenuState(null)}>
                                            <DropdownMenuTrigger asChild>
                                              <Button
                                                variant='ghost'
                                                size='sm'
                                                className='size-6 p-0 border border-primary/50 hover:border-primary'
                                                title='选择IP地址'
                                              >
                                                <img src={IpIcon} alt='IP' className='size-4' />
                                              </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align='start'>
                                              {ipMenuState.ips.map((ip) => (
                                                <DropdownMenuItem
                                                  key={ip}
                                                  onClick={() => {
                                                    if (node.isSaved && node.dbId) {
                                                      updateNodeServerMutation.mutate({
                                                        nodeId: node.dbId,
                                                        server: ip,
                                                      })
                                                    } else {
                                                      updateTempNodeServer(node.id, ip)
                                                      setIpMenuState(null)
                                                    }
                                                  }}
                                                >
                                                  <span className='font-mono'>{ip}</span>
                                                </DropdownMenuItem>
                                              ))}
                                            </DropdownMenuContent>
                                          </DropdownMenu>
                                        ) : (
                                          <Button
                                            variant='ghost'
                                            size='sm'
                                            className='size-6 p-0 border border-primary/50 hover:border-primary'
                                            title='解析IP地址'
                                            disabled={resolvingIpFor === nodeKey}
                                            onClick={() => handleResolveIp(node)}
                                          >
                                            <img src={IpIcon} alt='IP' className='size-4' />
                                          </Button>
                                        )
                                      })()
                                    )}
                                    {node.isSaved && node.dbNode?.original_server && (
                                      <Button
                                        variant='ghost'
                                        size='sm'
                                        className='size-6 p-0 border border-primary/50 hover:border-primary ml-1'
                                        title='恢复原始域名'
                                        disabled={restoreNodeServerMutation.isPending}
                                        onClick={() => restoreNodeServerMutation.mutate(node.dbId)}
                                      >
                                        <Undo2 className='size-3' />
                                      </Button>
                                    )}
                                    {userConfig?.enable_probe_binding && node.isSaved && node.dbNode && (
                                      <Button
                                        variant='ghost'
                                        size='sm'
                                        className='size-6 p-0 border border-primary/50 hover:border-primary ml-1'
                                        title={node.dbNode.probe_server ? `当前绑定: ${node.dbNode.probe_server}` : '绑定探针服务器'}
                                        onClick={() => {
                                          setSelectedNodeForProbe(node.dbNode!)
                                          setProbeBindingDialogOpen(true)
                                          refetchProbeConfig() // 打开对话框时查询探针配置
                                        }}
                                      >
                                        <Activity className={`size-4 ${node.dbNode.probe_server ? 'text-green-600' : ''}`} />
                                      </Button>
                                    )}
                                  </div>
                                ) : (
                                  '-'
                                )}
                              </div>
                            </TableCell>
                            <TableCell className='text-center'>
                              {node.clash ? (
                                <Dialog>
                                  <DialogTrigger asChild>
                                    <Button variant='ghost' size='icon' className='h-8 w-8'>
                                      <Eye className='h-4 w-4' />
                                    </Button>
                                  </DialogTrigger>
                                  <DialogContent className='max-w-2xl max-h-[80vh] overflow-auto'>
                                    <DialogHeader>
                                      <DialogTitle>Clash 配置详情</DialogTitle>
                                      <DialogDescription>
                                        {node.name || '未知'}
                                      </DialogDescription>
                                    </DialogHeader>
                                    <div className='mt-4'>
                                      <pre className='text-xs bg-muted p-4 rounded overflow-auto'>
                                        {JSON.stringify(node.clash, null, 2)}
                                      </pre>
                                    </div>
                                  </DialogContent>
                                </Dialog>
                              ) : (
                                <span className='text-xs text-muted-foreground'>-</span>
                              )}
                            </TableCell>
                            <TableCell className='text-center'>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant='ghost'
                                    size='sm'
                                    disabled={node.isSaved && deleteMutation.isPending}
                                  >
                                    删除
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>确认删除</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      确定要删除节点 "{node.name || '未知'}" 吗？
                                      {node.isSaved && '此操作不可撤销。'}
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>取消</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => node.isSaved ? handleDelete(node.dbId) : handleDeleteTemp(node.id)}
                                    >
                                      删除
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </section>
      </main>

      {/* 探针绑定对话框 */}
      <Dialog open={probeBindingDialogOpen} onOpenChange={setProbeBindingDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>绑定探针服务器</DialogTitle>
            <DialogDescription>
              为节点 "{selectedNodeForProbe?.node_name}" 选择要绑定的探针服务器
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4 py-4'>
            {probeConfig?.servers && probeConfig.servers.length > 0 ? (
              <div className='space-y-2'>
                {probeConfig.servers.map((server) => (
                  <Button
                    key={server.id}
                    variant={selectedNodeForProbe?.probe_server === server.name ? 'default' : 'outline'}
                    className='w-full justify-start'
                    onClick={() => {
                      if (selectedNodeForProbe) {
                        updateProbeBindingMutation.mutate({
                          nodeId: selectedNodeForProbe.id,
                          probeServer: server.name
                        })
                      }
                    }}
                    disabled={updateProbeBindingMutation.isPending}
                  >
                    <div className='flex items-center gap-2'>
                      <Activity className='size-4' />
                      <div className='text-left'>
                        <div className='font-medium'>{server.name}</div>
                        <div className='text-xs text-muted-foreground'>ID: {server.server_id}</div>
                      </div>
                    </div>
                  </Button>
                ))}
                {selectedNodeForProbe?.probe_server && (
                  <Button
                    variant='ghost'
                    className='w-full'
                    onClick={() => {
                      if (selectedNodeForProbe) {
                        updateProbeBindingMutation.mutate({
                          nodeId: selectedNodeForProbe.id,
                          probeServer: ''
                        })
                      }
                    }}
                    disabled={updateProbeBindingMutation.isPending}
                  >
                    <X className='size-4 mr-2' />
                    取消绑定
                  </Button>
                )}
              </div>
            ) : (
              <div className='text-center text-sm text-muted-foreground py-8'>
                暂无可用的探针服务器
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
