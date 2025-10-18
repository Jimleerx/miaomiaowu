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
  created_at: string
  updated_at: string
}

type TempNode = {
  id: string
  rawUrl: string
  parsed: ProxyNode | null
  clash: ClashProxy | null
  enabled: boolean
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

function NodesPage() {
  const { auth } = useAuthStore()
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [subscriptionUrl, setSubscriptionUrl] = useState('')
  const [tempNodes, setTempNodes] = useState<TempNode[]>([])
  const [selectedProtocol, setSelectedProtocol] = useState<string>('all')

  // 获取已保存的节点
  const { data: nodesData } = useQuery({
    queryKey: ['nodes'],
    queryFn: async () => {
      const response = await api.get('/api/nodes')
      return response.data as { nodes: ParsedNode[] }
    },
    enabled: Boolean(auth.accessToken),
  })

  const savedNodes = nodesData?.nodes ?? []

  // 批量创建节点
  const batchCreateMutation = useMutation({
    mutationFn: async (nodes: TempNode[]) => {
      const payload = nodes.map(n => ({
        raw_url: n.rawUrl,
        node_name: n.parsed?.name || '未知',
        protocol: n.parsed?.type || 'unknown',
        parsed_config: n.parsed ? JSON.stringify(n.parsed) : '',
        clash_config: n.clash ? JSON.stringify(n.clash) : '',
        enabled: n.enabled,
      }))

      const response = await api.post('/api/nodes/batch', { nodes: payload })
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

      const response = await api.put(`/api/nodes/${id}`, {
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
      await api.delete(`/api/nodes/${id}`)
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
      await api.post('/api/nodes/clear')
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
      const response = await api.post('/api/nodes/fetch-subscription', { url })
      return response.data as { proxies: ClashProxy[]; count: number }
    },
    onSuccess: (data) => {
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

        return {
          id: Math.random().toString(36).substring(7),
          rawUrl: '', // Clash订阅的节点没有原始URL
          parsed: proxyNode,
          clash: clashNode,
          enabled: true,
        }
      })

      setTempNodes(parsed)
      toast.success(`成功导入 ${data.count} 个节点`)
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

      parsed.push({
        id: Math.random().toString(36).substring(7),
        rawUrl: trimmed,
        parsed: parsedNode,
        clash: clashNode,
        enabled: true,
      })
    }

    setTempNodes(parsed)
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
      return {
        id: n.id.toString(),
        rawUrl: n.raw_url,
        parsed,
        clash,
        enabled: n.enabled,
        isSaved: true,
        dbId: n.id,
      }
    })

    // 临时节点
    const temp = tempNodes.map(n => ({
      ...n,
      isSaved: false,
      dbId: 0,
    }))

    return [...temp, ...saved]
  }, [savedNodes, tempNodes])

  const filteredNodes = useMemo(() => {
    if (selectedProtocol === 'all') return displayNodes
    return displayNodes.filter(node => node.parsed?.type === selectedProtocol)
  }, [displayNodes, selectedProtocol])

  const protocolCounts = useMemo(() => {
    const counts: Record<string, number> = { all: displayNodes.length }
    for (const protocol of PROTOCOLS) {
      counts[protocol] = displayNodes.filter(n => n.parsed?.type === protocol).length
    }
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
              输入代理节点信息，每行一个节点，支持 VMess、VLESS、Trojan、Shadowsocks、Hysteria、Socks、Shadowsocks 协议。
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

                {/* 节点表格 */}
                <div className='rounded-md border overflow-auto'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className='w-[100px]'>协议</TableHead>
                        <TableHead className='min-w-[150px]'>节点名称</TableHead>
                        <TableHead className='min-w-[200px]'>服务器地址</TableHead>
                        <TableHead className='min-w-[200px]'>Clash 配置</TableHead>
                        <TableHead className='w-[80px] text-center'>启用</TableHead>
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
                              <div className='flex items-center gap-2'>
                                {node.parsed?.name || '未知'}
                                {node.isSaved && (
                                  <Badge variant='secondary' className='text-xs'>已保存</Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className='text-sm text-muted-foreground'>
                                {node.parsed ? (
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
                                ) : (
                                  '-'
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {node.clash ? (
                                <Dialog>
                                  <DialogTrigger asChild>
                                    <Button variant='ghost' size='sm' className='h-auto py-1 px-2'>
                                      <div className='text-xs font-mono text-left truncate max-w-[180px]'>
                                        {JSON.stringify(node.clash).substring(0, 50)}...
                                      </div>
                                    </Button>
                                  </DialogTrigger>
                                  <DialogContent className='max-w-2xl max-h-[80vh] overflow-auto'>
                                    <DialogHeader>
                                      <DialogTitle>Clash 配置详情</DialogTitle>
                                      <DialogDescription>
                                        {node.parsed?.name || '未知'}
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
                                <span className='text-xs text-muted-foreground'>转换失败</span>
                              )}
                            </TableCell>
                            <TableCell className='text-center'>
                              {node.isSaved ? (
                                <Switch
                                  checked={node.enabled}
                                  onCheckedChange={() => handleToggle(node.dbId)}
                                />
                              ) : (
                                <Switch
                                  checked={node.enabled}
                                  disabled={true}
                                />
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
                                      确定要删除节点 "{node.parsed?.name || '未知'}" 吗？
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
    </div>
  )
}
