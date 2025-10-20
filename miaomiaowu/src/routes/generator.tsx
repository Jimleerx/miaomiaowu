import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Copy, Download, Loader2 } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
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
import { ClashConfigBuilderNew } from '@/lib/sublink/clash-builder-new'
import { CustomRulesEditor } from '@/components/custom-rules-editor'
import { RuleSelector } from '@/components/rule-selector'
import type { PredefinedRuleSetType, CustomRule } from '@/lib/sublink/types'
import type { ProxyConfig } from '@/lib/sublink/types'

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
  const [ruleSet, setRuleSet] = useState<PredefinedRuleSetType>('balanced')
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [customRules, setCustomRules] = useState<CustomRule[]>([])
  const [loading, setLoading] = useState(false)
  const [clashConfig, setClashConfig] = useState('')
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<number>>(new Set())

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
    if (selectedNodeIds.size === enabledNodes.length) {
      setSelectedNodeIds(new Set())
    } else {
      setSelectedNodeIds(new Set(enabledNodes.map(n => n.id)))
    }
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
      const clashBuilder = new ClashConfigBuilderNew(
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
                <div className='rounded-md border'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className='w-[50px]'>
                          <Checkbox
                            checked={selectedNodeIds.size === enabledNodes.length && enabledNodes.length > 0}
                            onCheckedChange={handleToggleAll}
                          />
                        </TableHead>
                        <TableHead>节点名称</TableHead>
                        <TableHead className='w-[100px]'>协议</TableHead>
                        <TableHead className='w-[100px]'>标签</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {enabledNodes.map((node) => (
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
    </div>
  )
}
