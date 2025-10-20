import { useState, useRef } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Download, Loader2, Save, Layers, GripVertical, X } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { ClashConfigBuilder } from '@/lib/sublink/clash-builder'
import { CustomRulesEditor } from '@/components/custom-rules-editor'
import { RuleSelector } from '@/components/rule-selector'
import type { PredefinedRuleSetType, CustomRule } from '@/lib/sublink/types'
import type { ProxyConfig } from '@/lib/sublink/types'
import { CATEGORY_TO_RULE_NAME, translateOutbound } from '@/lib/sublink/translations'
import yaml from 'js-yaml'

type SavedNode = {
  id: number
  raw_url: string
  node_name: string
  protocol: string
  parsed_config: string
  clash_config: string
  enabled: boolean
  tag: string
  created_at: string
  updated_at: string
}

export const Route = createFileRoute('/generator')({
  beforeLoad: () => {
    const token = useAuthStore.getState().auth.accessToken
    if (!token) {
      throw redirect({ to: '/login' })
    }
  },
  component: SubscriptionGeneratorPage,
})

function SubscriptionGeneratorPage() {
  const { auth } = useAuthStore()
  const queryClient = useQueryClient()
  const [ruleSet, setRuleSet] = useState<PredefinedRuleSetType>('balanced')
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [customRules, setCustomRules] = useState<CustomRule[]>([])
  const [loading, setLoading] = useState(false)
  const [clashConfig, setClashConfig] = useState('')
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<number>>(new Set())
  const [protocolFilter, setProtocolFilter] = useState<string>('all')

  // 保存订阅对话框状态
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [subscribeName, setSubscribeName] = useState('')
  const [subscribeFilename, setSubscribeFilename] = useState('')
  const [subscribeDescription, setSubscribeDescription] = useState('')

  // 手动分组对话框状态
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [proxyGroups, setProxyGroups] = useState<ProxyGroup[]>([])
  const [availableProxies, setAvailableProxies] = useState<string[]>([])
  const [draggedItem, setDraggedItem] = useState<{ proxy: string; sourceGroup: string | null; sourceIndex: number } | null>(null)
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null)
  const dragTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // 获取已保存的节点
  const { data: nodesData } = useQuery({
    queryKey: ['nodes'],
    queryFn: async () => {
      const response = await api.get('/api/nodes')
      return response.data as { nodes: SavedNode[] }
    },
    enabled: Boolean(auth.accessToken),
  })

  const savedNodes = nodesData?.nodes ?? []
  const enabledNodes = savedNodes.filter(n => n.enabled)

  // 获取所有协议类型
  const protocols = Array.from(new Set(enabledNodes.map(n => n.protocol.toLowerCase()))).sort()

  // 根据协议筛选节点
  const filteredNodes = protocolFilter === 'all'
    ? enabledNodes
    : enabledNodes.filter(n => n.protocol.toLowerCase() === protocolFilter)

  const handleToggleNode = (nodeId: number) => {
    const newSet = new Set(selectedNodeIds)
    if (newSet.has(nodeId)) {
      newSet.delete(nodeId)
    } else {
      newSet.add(nodeId)
    }
    setSelectedNodeIds(newSet)
  }

  const handleToggleAll = () => {
    if (selectedNodeIds.size === filteredNodes.length) {
      setSelectedNodeIds(new Set())
    } else {
      setSelectedNodeIds(new Set(filteredNodes.map(n => n.id)))
    }
  }

  type ProxyGroup = {
    name: string
    type: string
    proxies: string[]
    url?: string
    interval?: number
    lazy?: boolean
  }

  const handleGetProxyGroups = (): ProxyGroup[] => {
    if (selectedNodeIds.size === 0) {
      toast.error('请选择至少一个节点')
      return []
    }
    const groups: ProxyGroup[] = []

    setLoading(true)
    try {
      // 获取选中的节点并转换为ProxyConfig
      const selectedNodes = savedNodes.filter(n => selectedNodeIds.has(n.id))
      const proxies: ProxyConfig[] = selectedNodes.map(node => {
        try {
          return JSON.parse(node.clash_config) as ProxyConfig
        } catch (e) {
          console.error('Failed to parse clash config for node:', node.node_name, e)
          return null
        }
      }).filter((p): p is ProxyConfig => p !== null)

      if (proxies.length === 0) {
        toast.error('未能解析到任何有效节点')
        return []
      }

      toast.success(`成功加载 ${proxies.length} 个节点`)

      // Validate custom rules
      const validCustomRules = customRules.filter((rule) => rule.name.trim() !== '')
      if (validCustomRules.length > 0) {
        toast.info(`应用 ${validCustomRules.length} 条自定义规则`)
      }

      // All rule sets now use selected categories
      if (selectedCategories.length > 0) {
        toast.info(`应用 ${selectedCategories.length} 个规则类别`)
      }

      // Build Clash config using new builder
      const proxyNames: string[] = proxies
        .map((p) => p.name)
        .filter((name): name is string => name !== undefined)
      // 1. Node Select group
      groups.push({
        name: translateOutbound('Node Select') || 'Node Select',
        type: 'select',
        proxies: ['DIRECT', 'REJECT', translateOutbound('Auto Select') || 'Auto Select', ...proxyNames],
      })

      // 2. Auto Select group
      groups.push({
        name: translateOutbound('Auto Select') || 'Auto Select',
        type: 'url-test',
        proxies: [...proxyNames],
        url: 'https://www.gstatic.com/generate_204',
        interval: 300,
        lazy: false,
      })

      // 3. Category-specific groups
      for (const categoryName of selectedCategories) {
        const ruleName = CATEGORY_TO_RULE_NAME[categoryName]
        if (!ruleName) continue

        groups.push({
          name: translateOutbound(ruleName) || ruleName,
          type: 'select',
          proxies: [
            translateOutbound('Node Select') || 'Node Select',
            'DIRECT',
            'REJECT',
            translateOutbound('Auto Select') || 'Auto Select',
            ...proxyNames,
          ],
        })
      }

      // 4. Custom rule groups
      for (const rule of validCustomRules) {
        if (!rule.name) continue

        groups.push({
          name: translateOutbound(rule.name) || rule.name,
          type: 'select',
          proxies: [
            translateOutbound('Node Select') || 'Node Select',
            'DIRECT',
            'REJECT',
            translateOutbound('Auto Select') || 'Auto Select',
            ...proxyNames,
          ],
        })
      }

      // 5. Fall Back group
      groups.push({
        name: translateOutbound('Fall Back') || 'Fall Back',
        type: 'select',
        proxies: [
          translateOutbound('Node Select') || 'Node Select',
          'DIRECT',
          'REJECT',
          translateOutbound('Auto Select') || 'Auto Select',
          ...proxyNames,
        ],
      })

      toast.success('Clash 配置生成成功！')
    } catch (error) {
      console.error('Generation error:', error)
      toast.error('生成订阅链接失败')
    } finally {
      setLoading(false)
    }
    return groups
  }


  const handleGenerate = async () => {
    if (selectedNodeIds.size === 0) {
      toast.error('请选择至少一个节点')
      return
    }

    setLoading(true)
    try {
      // 获取选中的节点并转换为ProxyConfig
      const selectedNodes = savedNodes.filter(n => selectedNodeIds.has(n.id))
      const proxies: ProxyConfig[] = selectedNodes.map(node => {
        try {
          return JSON.parse(node.clash_config) as ProxyConfig
        } catch (e) {
          console.error('Failed to parse clash config for node:', node.node_name, e)
          return null
        }
      }).filter((p): p is ProxyConfig => p !== null)

      if (proxies.length === 0) {
        toast.error('未能解析到任何有效节点')
        return
      }

      toast.success(`成功加载 ${proxies.length} 个节点`)

      // Validate custom rules
      const validCustomRules = customRules.filter((rule) => rule.name.trim() !== '')
      if (validCustomRules.length > 0) {
        toast.info(`应用 ${validCustomRules.length} 条自定义规则`)
      }

      // All rule sets now use selected categories
      if (selectedCategories.length > 0) {
        toast.info(`应用 ${selectedCategories.length} 个规则类别`)
      }

      // Build Clash config using new builder
      const clashBuilder = new ClashConfigBuilder(
        proxies,
        selectedCategories,
        validCustomRules
      )
      const generatedConfig = clashBuilder.build()

      setClashConfig(generatedConfig)

      toast.success('Clash 配置生成成功！')
    } catch (error) {
      console.error('Generation error:', error)
      toast.error('生成订阅链接失败')
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(clashConfig)
    toast.success('Clash 配置已复制到剪贴板')
  }

  const downloadClashConfig = () => {
    const blob = new Blob([clashConfig], { type: 'text/yaml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'clash-config.yaml'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('clash-config.yaml 下载成功')
  }

  const handleClear = () => {
    setSelectedNodeIds(new Set())
    setSelectedCategories([])
    setCustomRules([])
    setClashConfig('')
    toast.info('已清空所有内容')
  }

  // 保存订阅 mutation
  const saveSubscribeMutation = useMutation({
    mutationFn: async (data: { name: string; filename: string; description: string; content: string }) => {
      const response = await api.post('/api/admin/subscribe-files/create-from-config', data)
      return response.data
    },
    onSuccess: () => {
      toast.success('订阅保存成功！')
      toast.info('请前往"订阅文件"页面查看')
      setSaveDialogOpen(false)
      setSubscribeName('')
      setSubscribeFilename('')
      setSubscribeDescription('')
      queryClient.invalidateQueries({ queryKey: ['subscribe-files'] })
      queryClient.invalidateQueries({ queryKey: ['user-subscriptions'] })
    },
    onError: (error: any) => {
      const message = error.response?.data?.error || '保存订阅失败'
      toast.error(message)
    },
  })

  const handleOpenSaveDialog = () => {
    if (!clashConfig) {
      toast.error('请先生成配置')
      return
    }
    setSaveDialogOpen(true)
  }

  const handleSaveSubscribe = () => {
    if (!subscribeName.trim()) {
      toast.error('请输入订阅名称')
      return
    }

    saveSubscribeMutation.mutate({
      name: subscribeName.trim(),
      filename: subscribeFilename.trim(),
      description: subscribeDescription.trim(),
      content: clashConfig,
    })
  }

  // 手动分组功能
  const handleOpenGroupDialog = () => {
    if (!clashConfig) {
      toast.error('请先生成配置')
      return
    }

    try {
      // 解析当前的 Clash 配置
      const parsedConfig = yaml.load(clashConfig) as any

      if (!parsedConfig['proxy-groups']) {
        toast.error('配置中没有找到代理组')
        return
      }

      // 获取所有代理组，确保每个组都有 proxies 数组
      const groups = (parsedConfig['proxy-groups'] as any[]).map(group => ({
        ...group,
        proxies: group.proxies || []
      })) as ProxyGroup[]

      // 获取所有可用的代理节点，添加默认的特殊节点
      const allProxies = parsedConfig.proxies?.map((p: any) => p.name) || []
      const specialNodes = ['⚡ 自动选择', '🚀 节点选择', 'DIRECT', 'REJECT']
      const availableNodes = [...specialNodes, ...allProxies]

      setProxyGroups(groups)
      setAvailableProxies(availableNodes)
      setGroupDialogOpen(true)
    } catch (error) {
      console.error('解析配置失败:', error)
      toast.error('解析配置失败，请检查配置格式')
    }
  }

  const handleApplyGrouping = () => {
    try {
      // 解析当前配置
      const parsedConfig = yaml.load(clashConfig) as any

      // 更新代理组，过滤掉 undefined 值
      parsedConfig['proxy-groups'] = proxyGroups.map(group => ({
        ...group,
        proxies: group.proxies.filter((p): p is string => p !== undefined)
      }))

      // 转换回 YAML
      const newConfig = yaml.dump(parsedConfig, {
        lineWidth: -1,
        noRefs: true,
      })

      setClashConfig(newConfig)
      setGroupDialogOpen(false)
      toast.success('分组已应用到配置')
    } catch (error) {
      console.error('应用分组失败:', error)
      toast.error('应用分组失败，请检查配置')
    }
  }

  // 拖拽处理函数
  const handleDragStart = (proxy: string, sourceGroup: string | null, sourceIndex: number) => {
    setDraggedItem({ proxy, sourceGroup, sourceIndex })
  }

  const handleDragEnd = () => {
    setDraggedItem(null)
    setDragOverGroup(null)
  }

  const handleDragEnterGroup = (groupName: string) => {
    // 清除之前的定时器
    if (dragTimeoutRef.current) {
      clearTimeout(dragTimeoutRef.current)
    }
    // 立即设置高亮状态
    setDragOverGroup(groupName)
  }

  const handleDragLeaveGroup = () => {
    // 使用防抖延迟清除高亮，避免在节点交界处抖动
    if (dragTimeoutRef.current) {
      clearTimeout(dragTimeoutRef.current)
    }
    dragTimeoutRef.current = setTimeout(() => {
      setDragOverGroup(null)
    }, 50)
  }

  const handleDrop = (targetGroupName: string, targetIndex?: number) => {
    if (!draggedItem) return

    setProxyGroups(groups => {
      const newGroups = groups.map(group => {
        // 从源组中移除
        if (group.name === draggedItem.sourceGroup) {
          return {
            ...group,
            proxies: group.proxies.filter((_, idx) => idx !== draggedItem.sourceIndex)
          }
        }
        return group
      })

      // 添加到目标组
      return newGroups.map(group => {
        if (group.name === targetGroupName) {
          // 检查是否已存在
          if (!group.proxies.includes(draggedItem.proxy)) {
            const newProxies = [...group.proxies]
            if (targetIndex !== undefined) {
              // 插入到指定位置
              newProxies.splice(targetIndex, 0, draggedItem.proxy)
            } else {
              // 添加到末尾
              newProxies.push(draggedItem.proxy)
            }
            return {
              ...group,
              proxies: newProxies
            }
          }
        }
        return group
      })
    })

    setDraggedItem(null)
    setDragOverGroup(null)
  }

  const handleDropToAvailable = () => {
    if (!draggedItem || !draggedItem.sourceGroup) return

    // 从源组中移除
    setProxyGroups(groups =>
      groups.map(group => {
        if (group.name === draggedItem.sourceGroup) {
          return {
            ...group,
            proxies: group.proxies.filter((_, idx) => idx !== draggedItem.sourceIndex)
          }
        }
        return group
      })
    )

    setDraggedItem(null)
    setDragOverGroup(null)
  }

  // 删除节点
  const handleRemoveProxy = (groupName: string, proxyIndex: number) => {
    setProxyGroups(groups =>
      groups.map(group => {
        if (group.name === groupName) {
          return {
            ...group,
            proxies: group.proxies.filter((_, idx) => idx !== proxyIndex)
          }
        }
        return group
      })
    )
  }

  // 删除整个代理组
  const handleRemoveGroup = (groupName: string) => {
    setProxyGroups(groups => groups.filter(group => group.name !== groupName))
  }

  return (
    <div className='flex min-h-screen flex-col bg-background'>
      <Topbar />

      <main className='container mx-auto flex-1 px-4 py-8'>
        <div className='mx-auto max-w-5xl space-y-6'>
          <div className='space-y-2'>
            <h1 className='text-3xl font-bold tracking-tight'>订阅链接生成器</h1>
            <p className='text-muted-foreground'>
              从节点管理中选择节点，快速生成 Clash 订阅配置
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>选择节点</CardTitle>
              <CardDescription>
                从已保存的节点中选择需要添加到订阅的节点（已选择 {selectedNodeIds.size} 个）
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              {enabledNodes.length === 0 ? (
                <div className='text-center py-8 text-muted-foreground'>
                  暂无可用节点，请先在节点管理中添加节点
                </div>
              ) : (
                <>
                  {/* 协议筛选按钮 */}
                  <div className='flex flex-wrap gap-2'>
                    <Button
                      variant={protocolFilter === 'all' ? 'default' : 'outline'}
                      size='sm'
                      onClick={() => setProtocolFilter('all')}
                    >
                      全部 ({enabledNodes.length})
                    </Button>
                    {protocols.map((protocol) => {
                      const count = enabledNodes.filter(n => n.protocol.toLowerCase() === protocol).length
                      return (
                        <Button
                          key={protocol}
                          variant={protocolFilter === protocol ? 'default' : 'outline'}
                          size='sm'
                          onClick={() => setProtocolFilter(protocol)}
                        >
                          {protocol.toUpperCase()} ({count})
                        </Button>
                      )
                    })}
                  </div>

                  <div className='rounded-md border'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className='w-[50px]'>
                          <Checkbox
                            checked={filteredNodes.length > 0 && filteredNodes.every(n => selectedNodeIds.has(n.id))}
                            onCheckedChange={handleToggleAll}
                          />
                        </TableHead>
                        <TableHead>节点名称</TableHead>
                        <TableHead className='w-[100px]'>协议</TableHead>
                        <TableHead className='w-[100px]'>标签</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredNodes.map((node) => (
                        <TableRow key={node.id}>
                          <TableCell>
                            <Checkbox
                              checked={selectedNodeIds.has(node.id)}
                              onCheckedChange={() => handleToggleNode(node.id)}
                            />
                          </TableCell>
                          <TableCell className='font-medium'>{node.node_name}</TableCell>
                          <TableCell>
                            <Badge variant='outline'>{node.protocol.toUpperCase()}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant='secondary' className='text-xs'>{node.tag}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                </>
              )}

              <RuleSelector
                ruleSet={ruleSet}
                onRuleSetChange={setRuleSet}
                selectedCategories={selectedCategories}
                onCategoriesChange={setSelectedCategories}
              />

              <div className='flex gap-2'>
                <Button onClick={handleGenerate} disabled={loading || selectedNodeIds.size === 0} className='flex-1'>
                  {loading && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
                  {loading ? '生成中...' : '生成订阅文件'}
                </Button>
                <Button variant='outline' onClick={handleClear}>
                  清空
                </Button>
              </div>
            </CardContent>
          </Card>

          <CustomRulesEditor rules={customRules} onChange={setCustomRules} />

          {clashConfig && (
            <Card>
              <CardHeader>
                <div className='flex items-center justify-between'>
                  <div>
                    <CardTitle>生成的 Clash 配置</CardTitle>
                    <CardDescription>
                      预览生成的 YAML 配置文件，可复制或下载
                    </CardDescription>
                  </div>
                  <div className='flex gap-2'>
                    <Button variant='outline' size='sm' onClick={copyToClipboard}>
                      <Copy className='mr-2 h-4 w-4' />
                      复制
                    </Button>
                    <Button variant='outline' size='sm' onClick={downloadClashConfig}>
                      <Download className='mr-2 h-4 w-4' />
                      下载
                    </Button>
                    <Button variant='outline' size='sm' onClick={handleOpenGroupDialog}>
                      <Layers className='mr-2 h-4 w-4' />
                      手动分组
                    </Button>
                    <Button size='sm' onClick={handleOpenSaveDialog}>
                      <Save className='mr-2 h-4 w-4' />
                      保存为订阅
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className='rounded-lg border bg-muted/30'>
                  <Textarea
                    value={clashConfig}
                    readOnly
                    className='min-h-[400px] resize-none border-0 bg-transparent font-mono text-xs'
                  />
                </div>
                <div className='mt-4 flex justify-end gap-2'>
                  <Button variant='outline' onClick={handleOpenGroupDialog}>
                    <Layers className='mr-2 h-4 w-4' />
                    手动分组
                  </Button>
                  <Button onClick={handleOpenSaveDialog}>
                    <Save className='mr-2 h-4 w-4' />
                    保存为订阅
                  </Button>
                </div>
                <div className='mt-4 rounded-lg border bg-muted/50 p-4'>
                  <h3 className='mb-2 font-semibold'>使用说明</h3>
                  <ul className='space-y-1 text-sm text-muted-foreground'>
                    <li>• 点击"复制"按钮将配置复制到剪贴板</li>
                    <li>• 点击"下载"按钮下载为 clash-config.yaml 文件</li>
                    <li>• 将配置文件导入 Clash 客户端即可使用</li>
                    <li>• 支持 Clash、Clash Meta、Mihomo 等客户端</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      {/* 保存订阅对话框 */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>保存为订阅</DialogTitle>
            <DialogDescription>
              将生成的配置保存为订阅文件，保存后可以在订阅管理中查看和使用
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4 py-4'>
            <div className='space-y-2'>
              <Label htmlFor='subscribe-name'>
                订阅名称 <span className='text-destructive'>*</span>
              </Label>
              <Input
                id='subscribe-name'
                placeholder='例如：我的订阅'
                value={subscribeName}
                onChange={(e) => setSubscribeName(e.target.value)}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='subscribe-filename'>文件名（可选）</Label>
              <Input
                id='subscribe-filename'
                placeholder='默认使用订阅名称'
                value={subscribeFilename}
                onChange={(e) => setSubscribeFilename(e.target.value)}
              />
              <p className='text-xs text-muted-foreground'>
                文件将保存到 subscribes 目录，自动添加 .yaml 扩展名
              </p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='subscribe-description'>说明（可选）</Label>
              <Textarea
                id='subscribe-description'
                placeholder='订阅说明...'
                value={subscribeDescription}
                onChange={(e) => setSubscribeDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setSaveDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSaveSubscribe} disabled={saveSubscribeMutation.isPending}>
              {saveSubscribeMutation.isPending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 手动分组对话框 */}
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className='!max-w-[95vw] w-[95vw] max-h-[90vh] overflow-y-auto' style={{ maxWidth: '95vw', width: '95vw' }}>
          <DialogHeader>
            <DialogTitle>手动分组节点</DialogTitle>
            <DialogDescription>
              拖拽节点到不同的代理组，自定义每个组的节点列表
            </DialogDescription>
          </DialogHeader>
          <div className='py-4'>
            <div className='flex gap-4'>
              {/* 左侧：代理组（自适应宽度） */}
              <div className='flex-1 grid gap-4' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
                {proxyGroups.map((group) => (
                  <Card
                    key={group.name}
                    className={`flex flex-col transition-all duration-75 ${
                      dragOverGroup === group.name
                        ? 'ring-2 ring-primary shadow-lg scale-[1.02]'
                        : ''
                    }`}
                    onDragOver={(e) => {
                      e.preventDefault()
                      handleDragEnterGroup(group.name)
                    }}
                    onDragLeave={handleDragLeaveGroup}
                    onDrop={() => handleDrop(group.name)}
                  >
                    <CardHeader className='pb-3'>
                      <div className='flex items-start justify-between gap-2'>
                        <div className='flex-1 min-w-0'>
                          <CardTitle className='text-base truncate'>{group.name}</CardTitle>
                          <CardDescription className='text-xs'>
                            {group.type} ({(group.proxies || []).length} 个节点)
                          </CardDescription>
                        </div>
                        <Button
                          variant='ghost'
                          size='sm'
                          className='h-6 w-6 p-0 flex-shrink-0'
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRemoveGroup(group.name)
                          }}
                        >
                          <X className='h-4 w-4 text-muted-foreground hover:text-destructive' />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className='flex-1 space-y-1 min-h-[200px]'>
                      {(group.proxies || []).map((proxy, idx) => (
                        proxy && (
                          <div
                            key={`${group.name}-${proxy}-${idx}`}
                            draggable
                            onDragStart={() => handleDragStart(proxy, group.name, idx)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              handleDragEnterGroup(group.name)
                            }}
                            onDrop={(e) => {
                              e.stopPropagation()
                              handleDrop(group.name, idx)
                            }}
                            className='flex items-center gap-2 p-2 rounded border bg-background hover:bg-accent cursor-move transition-all duration-75 group/item'
                          >
                            <GripVertical className='h-4 w-4 text-muted-foreground flex-shrink-0' />
                            <span className='text-sm truncate flex-1'>{proxy}</span>
                            <Button
                              variant='ghost'
                              size='sm'
                              className='h-6 w-6 p-0'
                              onClick={(e) => {
                                e.stopPropagation()
                                handleRemoveProxy(group.name, idx)
                              }}
                            >
                              <X className='h-4 w-4 text-muted-foreground hover:text-destructive' />
                            </Button>
                          </div>
                        )
                      ))}
                      {(group.proxies || []).filter(p => p).length === 0 && (
                        <div className={`text-sm text-center py-8 transition-colors ${
                          dragOverGroup === group.name
                            ? 'text-primary font-medium'
                            : 'text-muted-foreground'
                        }`}>
                          将节点拖拽到这里
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* 分割线 */}
              <div className='w-px bg-border flex-shrink-0'></div>

              {/* 右侧：可用节点 */}
              <div className='w-64 flex-shrink-0'>
                <Card
                  className={`sticky top-4 transition-all duration-75 ${
                    dragOverGroup === 'available'
                      ? 'ring-2 ring-primary shadow-lg scale-[1.02]'
                      : ''
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault()
                    handleDragEnterGroup('available')
                  }}
                  onDragLeave={handleDragLeaveGroup}
                  onDrop={handleDropToAvailable}
                >
                  <CardHeader className='pb-3'>
                    <CardTitle className='text-base'>可用节点</CardTitle>
                    <CardDescription className='text-xs'>
                      {availableProxies.length} 个节点
                    </CardDescription>
                  </CardHeader>
                  <CardContent className='space-y-1 max-h-[500px] overflow-y-auto'>
                    {availableProxies.map((proxy, idx) => (
                      <div
                        key={`available-${proxy}-${idx}`}
                        draggable
                        onDragStart={() => handleDragStart(proxy, null, idx)}
                        onDragEnd={handleDragEnd}
                        className='flex items-center gap-2 p-2 rounded border bg-background hover:bg-accent cursor-move transition-all duration-75'
                      >
                        <GripVertical className='h-4 w-4 text-muted-foreground flex-shrink-0' />
                        <span className='text-sm truncate flex-1'>{proxy}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setGroupDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleApplyGrouping}>
              应用分组
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
