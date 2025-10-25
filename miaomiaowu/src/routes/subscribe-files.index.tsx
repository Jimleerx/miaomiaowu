// @ts-nocheck
import { useState, useEffect, useMemo } from 'react'
import { createFileRoute, redirect, Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { load as parseYAML, dump as dumpYAML } from 'js-yaml'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Label } from '@/components/ui/label'
import { Upload, Download, Plus, Edit, Settings, FileText, Save, GripVertical, X, Layers } from 'lucide-react'

export const Route = createFileRoute('/subscribe-files/')({
  beforeLoad: () => {
    const token = useAuthStore.getState().auth.accessToken
    if (!token) {
      throw redirect({ to: '/' })
    }
  },
  component: SubscribeFilesPage,
})

type SubscribeFile = {
  id: number
  name: string
  description: string
  type: 'create' | 'import' | 'upload'
  filename: string
  created_at: string
  updated_at: string
  latest_version?: number
}

const TYPE_COLORS = {
  create: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  import: 'bg-green-500/10 text-green-700 dark:text-green-400',
  upload: 'bg-purple-500/10 text-purple-700 dark:text-purple-400',
}

const TYPE_LABELS = {
  create: '创建',
  import: '导入',
  upload: '上传',
}

function SubscribeFilesPage() {
  const { auth } = useAuthStore()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  // 日期格式化器
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        hour12: false,
      }),
    []
  )

  // 对话框状态
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingFile, setEditingFile] = useState<SubscribeFile | null>(null)
  const [editMetadataDialogOpen, setEditMetadataDialogOpen] = useState(false)
  const [editingMetadata, setEditingMetadata] = useState<SubscribeFile | null>(null)
  const [editConfigDialogOpen, setEditConfigDialogOpen] = useState(false)
  const [editingConfigFile, setEditingConfigFile] = useState<SubscribeFile | null>(null)

  // 编辑节点Dialog状态
  const [editNodesDialogOpen, setEditNodesDialogOpen] = useState(false)
  const [editingNodesFile, setEditingNodesFile] = useState<SubscribeFile | null>(null)
  const [proxyGroups, setProxyGroups] = useState<Array<{ name: string; type: string; proxies: string[] }>>([])
  const [showAllNodes, setShowAllNodes] = useState(true)
  const [draggedNode, setDraggedNode] = useState<{ name: string; fromGroup: string | null; fromIndex: number } | null>(null)
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null)

  // 编辑器状态
  const [editorValue, setEditorValue] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  // 编辑配置状态
  const [configContent, setConfigContent] = useState('')

  // 导入表单
  const [importForm, setImportForm] = useState({
    name: '',
    description: '',
    url: '',
    filename: '',
  })

  // 上传表单
  const [uploadForm, setUploadForm] = useState({
    name: '',
    description: '',
    filename: '',
  })
  const [uploadFile, setUploadFile] = useState<File | null>(null)

  // 编辑元数据表单
  const [metadataForm, setMetadataForm] = useState({
    name: '',
    description: '',
    filename: '',
  })

  // 获取订阅文件列表
  const { data: filesData, isLoading } = useQuery({
    queryKey: ['subscribe-files'],
    queryFn: async () => {
      const response = await api.get('/api/admin/subscribe-files')
      return response.data as { files: SubscribeFile[] }
    },
    enabled: Boolean(auth.accessToken),
  })

  const files = filesData?.files ?? []

  // 导入订阅
  const importMutation = useMutation({
    mutationFn: async (data: typeof importForm) => {
      const response = await api.post('/api/admin/subscribe-files/import', data)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscribe-files'] })
      queryClient.invalidateQueries({ queryKey: ['user-subscriptions'] })
      toast.success('订阅导入成功')
      setImportDialogOpen(false)
      setImportForm({ name: '', description: '', url: '', filename: '' })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '导入失败')
    },
  })

  // 上传文件
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!uploadFile) {
        throw new Error('请选择文件')
      }

      const formData = new FormData()
      formData.append('file', uploadFile)
      formData.append('name', uploadForm.name || uploadFile.name)
      formData.append('description', uploadForm.description)
      formData.append('filename', uploadForm.filename || uploadFile.name)

      const response = await api.post('/api/admin/subscribe-files/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscribe-files'] })
      queryClient.invalidateQueries({ queryKey: ['user-subscriptions'] })
      toast.success('文件上传成功')
      setUploadDialogOpen(false)
      setUploadForm({ name: '', description: '', filename: '' })
      setUploadFile(null)
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '上传失败')
    },
  })

  // 删除订阅
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/admin/subscribe-files/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscribe-files'] })
      queryClient.invalidateQueries({ queryKey: ['user-subscriptions'] })
      toast.success('订阅已删除')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '删除失败')
    },
  })

  // 更新订阅元数据
  const updateMetadataMutation = useMutation({
    mutationFn: async (payload: { id: number; data: typeof metadataForm }) => {
      const response = await api.put(`/api/admin/subscribe-files/${payload.id}`, payload.data)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscribe-files'] })
      queryClient.invalidateQueries({ queryKey: ['user-subscriptions'] })
      toast.success('订阅信息已更新')
      setEditMetadataDialogOpen(false)
      setEditingMetadata(null)
      setMetadataForm({ name: '', description: '', filename: '' })
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '更新失败')
    },
  })

  // 获取文件内容
  const fileContentQuery = useQuery({
    queryKey: ['rule-file', editingFile?.filename],
    queryFn: async () => {
      if (!editingFile) return null
      const response = await api.get(`/api/admin/rules/${encodeURIComponent(editingFile.filename)}`)
      return response.data as {
        name: string
        content: string
        latest_version: number
      }
    },
    enabled: Boolean(editingFile && auth.accessToken),
    refetchOnWindowFocus: false,
  })

  // 查询配置文件内容（编辑配置用）
  const configFileContentQuery = useQuery({
    queryKey: ['subscribe-file-content', editingConfigFile?.filename],
    queryFn: async () => {
      if (!editingConfigFile) return null
      const response = await api.get(`/api/admin/subscribe-files/${encodeURIComponent(editingConfigFile.filename)}/content`)
      return response.data as { content: string }
    },
    enabled: Boolean(editingConfigFile && auth.accessToken),
    refetchOnWindowFocus: false,
  })

  // 查询节点列表（编辑节点用）
  const nodesQuery = useQuery({
    queryKey: ['nodes'],
    queryFn: async () => {
      const response = await api.get('/api/admin/nodes')
      return response.data as { nodes: Array<{ id: number; node_name: string }> }
    },
    enabled: Boolean(editNodesDialogOpen && auth.accessToken),
    refetchOnWindowFocus: false,
  })

  // 查询配置文件内容（编辑节点用）
  const nodesConfigQuery = useQuery({
    queryKey: ['nodes-config-content', editingNodesFile?.filename],
    queryFn: async () => {
      if (!editingNodesFile) return null
      const response = await api.get(`/api/admin/subscribe-files/${encodeURIComponent(editingNodesFile.filename)}/content`)
      return response.data as { content: string }
    },
    enabled: Boolean(editingNodesFile && auth.accessToken),
    refetchOnWindowFocus: false,
  })

  // 保存文件
  const saveMutation = useMutation({
    mutationFn: async (payload: { file: string; content: string }) => {
      const response = await api.put(`/api/admin/rules/${encodeURIComponent(payload.file)}`, {
        content: payload.content,
      })
      return response.data as { version: number }
    },
    onSuccess: () => {
      toast.success('规则已保存')
      setIsDirty(false)
      setValidationError(null)
      queryClient.invalidateQueries({ queryKey: ['rule-file', editingFile?.filename] })
      // 关闭编辑对话框
      setEditDialogOpen(false)
      setEditingFile(null)
      setEditorValue('')
    },
    onError: (error) => {
      handleServerError(error)
    },
  })

  // 保存配置文件内容
  const saveConfigMutation = useMutation({
    mutationFn: async (payload: { filename: string; content: string }) => {
      const response = await api.put(`/api/admin/subscribe-files/${encodeURIComponent(payload.filename)}/content`, {
        content: payload.content,
      })
      return response.data
    },
    onSuccess: () => {
      toast.success('配置已保存')
      queryClient.invalidateQueries({ queryKey: ['subscribe-file-content', editingConfigFile?.filename] })
      queryClient.invalidateQueries({ queryKey: ['subscribe-files'] })
      setEditConfigDialogOpen(false)
      setEditingConfigFile(null)
      setConfigContent('')
    },
    onError: (error) => {
      handleServerError(error)
    },
  })

  // 当文件内容加载完成时，更新编辑器
  useEffect(() => {
    if (!fileContentQuery.data) return
    setEditorValue(fileContentQuery.data.content ?? '')
    setIsDirty(false)
    setValidationError(null)
  }, [fileContentQuery.data])

  // YAML 验证
  useEffect(() => {
    if (!editingFile || fileContentQuery.isLoading) return

    const timer = setTimeout(() => {
      const trimmed = editorValue.trim()
      if (!trimmed) {
        setValidationError('内容不能为空')
        return
      }

      try {
        parseYAML(editorValue)
        setValidationError(null)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'YAML 解析失败'
        setValidationError(message)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [editorValue, editingFile, fileContentQuery.isLoading])

  // 加载配置文件内容
  useEffect(() => {
    if (!configFileContentQuery.data) return
    setConfigContent(configFileContentQuery.data.content ?? '')
  }, [configFileContentQuery.data])

  // 解析YAML配置并提取代理组（编辑节点用）
  useEffect(() => {
    if (!nodesConfigQuery.data?.content) return

    try {
      const parsed = parseYAML(nodesConfigQuery.data.content) as any
      if (parsed && parsed['proxy-groups']) {
        const groups = parsed['proxy-groups'].map((group: any) => ({
          name: group.name || '',
          type: group.type || '',
          proxies: Array.isArray(group.proxies) ? group.proxies : [],
        }))
        setProxyGroups(groups)
      }
    } catch (error) {
      console.error('解析YAML失败:', error)
      toast.error('解析配置文件失败')
    }
  }, [nodesConfigQuery.data])

  const handleEdit = (file: SubscribeFile) => {
    setEditingFile(file)
    setEditDialogOpen(true)
    // 不要立即清空 editorValue，等待 useEffect 从 fileContentQuery 加载数据
    setIsDirty(false)
    setValidationError(null)
  }

  const handleSave = () => {
    if (!editingFile) return
    try {
      parseYAML(editorValue || '')
      setValidationError(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'YAML 解析失败'
      setValidationError(message)
      toast.error('保存失败，YAML 格式错误')
      return
    }

    saveMutation.mutate({ file: editingFile.filename, content: editorValue })
  }

  const handleReset = () => {
    if (!fileContentQuery.data) return
    setEditorValue(fileContentQuery.data.content ?? '')
    setIsDirty(false)
    setValidationError(null)
  }

  const handleImport = () => {
    if (!importForm.name || !importForm.url) {
      toast.error('请填写订阅名称和链接')
      return
    }
    importMutation.mutate(importForm)
  }

  const handleUpload = () => {
    if (!uploadFile) {
      toast.error('请选择文件')
      return
    }
    uploadMutation.mutate()
  }

  const handleDelete = (id: number) => {
    deleteMutation.mutate(id)
  }

  const handleEditMetadata = (file: SubscribeFile) => {
    setEditingMetadata(file)
    setMetadataForm({
      name: file.name,
      description: file.description,
      filename: file.filename,
    })
    setEditMetadataDialogOpen(true)
  }

  const handleUpdateMetadata = () => {
    if (!editingMetadata) return
    if (!metadataForm.name.trim()) {
      toast.error('请填写订阅名称')
      return
    }
    if (!metadataForm.filename.trim()) {
      toast.error('请填写文件名')
      return
    }
    updateMetadataMutation.mutate({
      id: editingMetadata.id,
      data: metadataForm,
    })
  }

  const handleEditConfig = (file: SubscribeFile) => {
    setEditingConfigFile(file)
    setEditConfigDialogOpen(true)
  }

  const handleSaveConfig = () => {
    if (!editingConfigFile) return
    try {
      parseYAML(configContent || '')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'YAML 解析失败'
      toast.error('保存失败，YAML 格式错误：' + message)
      return
    }
    saveConfigMutation.mutate({ filename: editingConfigFile.filename, content: configContent })
  }

  const handleEditNodes = (file: SubscribeFile) => {
    setEditingNodesFile(file)
    setEditNodesDialogOpen(true)
    setShowAllNodes(false)
  }

  const handleSaveNodes = async () => {
    if (!editingNodesFile || !nodesConfigQuery.data?.content) return

    try {
      const parsed = parseYAML(nodesConfigQuery.data.content) as any

      // 收集所有代理组中使用的节点名称
      const usedNodeNames = new Set<string>()
      proxyGroups.forEach(group => {
        group.proxies.forEach(proxy => {
          // 只添加实际节点（不是DIRECT、REJECT等特殊节点，也不是其他代理组）
          if (!['DIRECT', 'REJECT', 'PROXY', 'no-resolve'].includes(proxy) &&
              !proxyGroups.some(g => g.name === proxy)) {
            usedNodeNames.add(proxy)
          }
        })
      })

      // 如果有使用的节点，从nodesQuery获取它们的配置
      if (usedNodeNames.size > 0 && nodesQuery.data?.nodes) {
        // 获取使用的节点的Clash配置
        const nodeConfigs: any[] = []
        nodesQuery.data.nodes.forEach((node: any) => {
          if (usedNodeNames.has(node.node_name) && node.clash_config) {
            try {
              const clashConfig = typeof node.clash_config === 'string'
                ? JSON.parse(node.clash_config)
                : node.clash_config
              nodeConfigs.push(clashConfig)
            } catch (e) {
              console.error(`解析节点 ${node.node_name} 的配置失败:`, e)
            }
          }
        })

        // 更新proxies部分
        if (nodeConfigs.length > 0) {
          // 保留现有的proxies中不在usedNodeNames中的节点
          const existingProxies = parsed.proxies || []

          // 合并：使用新的节点配置，添加现有但未使用的节点
          const updatedProxies = [...nodeConfigs]

          // 添加现有但未使用的节点
          existingProxies.forEach((proxy: any) => {
            if (!usedNodeNames.has(proxy.name) && !updatedProxies.some(p => p.name === proxy.name)) {
              updatedProxies.push(proxy)
            }
          })

          parsed.proxies = updatedProxies
        }
      } else {
        // 如果没有使用的节点，保留原有的proxies或设置为空数组
        if (!parsed.proxies) {
          parsed.proxies = []
        }
      }

      // 更新代理组
      if (parsed && parsed['proxy-groups']) {
        parsed['proxy-groups'] = proxyGroups.map(group => ({
          name: group.name,
          type: group.type,
          proxies: group.proxies,
        }))
      }

      // 转换回YAML
      const newContent = dumpYAML(parsed, { lineWidth: -1, noRefs: true })

      // 更新编辑配置对话框中的内容
      setConfigContent(newContent)

      // 只关闭编辑节点对话框，不保存到文件
      setEditNodesDialogOpen(false)
      toast.success('已应用节点配置')
    } catch (error) {
      const message = error instanceof Error ? error.message : '应用配置失败'
      toast.error(message)
      console.error('应用节点配置失败:', error)
    }
  }

  // 拖拽相关函数
  const handleDragStart = (nodeName: string, fromGroup: string | null, fromIndex: number) => {
    setDraggedNode({ name: nodeName, fromGroup, fromIndex })
  }

  const handleDragEnd = () => {
    setDraggedNode(null)
    setDragOverGroup(null)
  }

  const handleDragEnterGroup = (groupName: string) => {
    setDragOverGroup(groupName)
  }

  const handleDragLeaveGroup = () => {
    setDragOverGroup(null)
  }

  const handleDrop = (toGroup: string) => {
    if (!draggedNode) return

    const updatedGroups = [...proxyGroups]

    // 从原来的位置移除（只有从代理组拖动时才移除，从可用节点拖动时不移除）
    if (draggedNode.fromGroup && draggedNode.fromGroup !== 'available' && draggedNode.name !== '__AVAILABLE_NODES__') {
      const fromGroupIndex = updatedGroups.findIndex(g => g.name === draggedNode.fromGroup)
      if (fromGroupIndex !== -1) {
        updatedGroups[fromGroupIndex].proxies = updatedGroups[fromGroupIndex].proxies.filter(
          (_, idx) => idx !== draggedNode.fromIndex
        )
      }
    }

    // 添加到新位置
    if (toGroup !== 'available') {
      const toGroupIndex = updatedGroups.findIndex(g => g.name === toGroup)
      if (toGroupIndex !== -1) {
        // 特殊处理：如果拖动的是"可用节点"标题，添加所有可用节点
        if (draggedNode.name === '__AVAILABLE_NODES__') {
          availableNodes.forEach(nodeName => {
            if (!updatedGroups[toGroupIndex].proxies.includes(nodeName)) {
              updatedGroups[toGroupIndex].proxies.push(nodeName)
            }
          })
        } else {
          // 防止代理组添加到自己内部
          if (draggedNode.name === toGroup) {
            handleDragEnd()
            return
          }
          // 检查节点是否已存在于目标组中
          if (!updatedGroups[toGroupIndex].proxies.includes(draggedNode.name)) {
            updatedGroups[toGroupIndex].proxies.push(draggedNode.name)
          }
        }
      }
    }

    setProxyGroups(updatedGroups)
    handleDragEnd()
  }

  const handleDropToAvailable = () => {
    if (!draggedNode || !draggedNode.fromGroup || draggedNode.fromGroup === 'available') {
      handleDragEnd()
      return
    }

    const updatedGroups = [...proxyGroups]
    const fromGroupIndex = updatedGroups.findIndex(g => g.name === draggedNode.fromGroup)

    if (fromGroupIndex !== -1) {
      updatedGroups[fromGroupIndex].proxies = updatedGroups[fromGroupIndex].proxies.filter(
        (_, idx) => idx !== draggedNode.fromIndex
      )
    }

    setProxyGroups(updatedGroups)
    handleDragEnd()
  }

  const handleRemoveNodeFromGroup = (groupName: string, nodeIndex: number) => {
    const updatedGroups = proxyGroups.map(group => {
      if (group.name === groupName) {
        return {
          ...group,
          proxies: group.proxies.filter((_, idx) => idx !== nodeIndex)
        }
      }
      return group
    })
    setProxyGroups(updatedGroups)
  }

  // 计算可用节点
  const availableNodes = useMemo(() => {
    if (!nodesQuery.data?.nodes) return []

    const allNodeNames = nodesQuery.data.nodes.map(n => n.node_name)

    if (showAllNodes) {
      return allNodeNames
    }

    // 获取所有代理组中已使用的节点
    const usedNodes = new Set<string>()
    proxyGroups.forEach(group => {
      group.proxies.forEach(proxy => usedNodes.add(proxy))
    })

    // 只返回未使用的节点
    return allNodeNames.filter(name => !usedNodes.has(name))
  }, [nodesQuery.data, proxyGroups, showAllNodes])

  return (
    <main className='mx-auto w-full max-w-7xl px-4 py-8 sm:px-6'>
      <section className='space-y-4'>
        <div className='flex flex-col gap-3 sm:gap-4'>
          <h1 className='text-3xl font-semibold tracking-tight'>订阅管理</h1>

          <div className='flex gap-2'>
            <p className='text-muted-foreground mt-2'>
              从Clash订阅链接导入或上传本地文件
            </p>
          </div>

          <div className='flex gap-2'>
            {/* 导入订阅 */}
            <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
              <DialogTrigger asChild>
                <Button variant='outline'>
                  <Download className='mr-2 h-4 w-4' />
                  导入订阅
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>导入订阅</DialogTitle>
                  <DialogDescription>
                    从 Clash 订阅链接导入，系统会自动下载并保存文件
                  </DialogDescription>
                </DialogHeader>
                <div className='space-y-4 py-4'>
                  <div className='space-y-2'>
                    <Label htmlFor='import-name'>订阅名称 *</Label>
                    <Input
                      id='import-name'
                      placeholder='例如：机场A'
                      value={importForm.name}
                      onChange={(e) => setImportForm({ ...importForm, name: e.target.value })}
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label htmlFor='import-url'>订阅链接 *</Label>
                    <Input
                      id='import-url'
                      placeholder='https://example.com/subscribe?token=xxx'
                      value={importForm.url}
                      onChange={(e) => setImportForm({ ...importForm, url: e.target.value })}
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label htmlFor='import-filename'>文件名（可选）</Label>
                    <Input
                      id='import-filename'
                      placeholder='留空则自动获取'
                      value={importForm.filename}
                      onChange={(e) => setImportForm({ ...importForm, filename: e.target.value })}
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label htmlFor='import-description'>说明（可选）</Label>
                    <Textarea
                      id='import-description'
                      placeholder='订阅说明信息'
                      value={importForm.description}
                      onChange={(e) => setImportForm({ ...importForm, description: e.target.value })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant='outline' onClick={() => setImportDialogOpen(false)}>
                    取消
                  </Button>
                  <Button onClick={handleImport} disabled={importMutation.isPending}>
                    {importMutation.isPending ? '导入中...' : '导入'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* 上传文件 */}
            <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
              <DialogTrigger asChild>
                <Button variant='outline'>
                  <Upload className='mr-2 h-4 w-4' />
                  上传文件
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>上传文件</DialogTitle>
                  <DialogDescription>
                    上传本地 YAML 格式的 Clash 订阅文件
                  </DialogDescription>
                </DialogHeader>
                <div className='space-y-4 py-4'>
                  <div className='space-y-2'>
                    <Label htmlFor='upload-file'>选择文件 *</Label>
                    <Input
                      id='upload-file'
                      type='file'
                      accept='.yaml,.yml'
                      onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label htmlFor='upload-name'>订阅名称（可选）</Label>
                    <Input
                      id='upload-name'
                      placeholder='留空则使用文件名'
                      value={uploadForm.name}
                      onChange={(e) => setUploadForm({ ...uploadForm, name: e.target.value })}
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label htmlFor='upload-filename'>文件名（可选）</Label>
                    <Input
                      id='upload-filename'
                      placeholder='留空则使用原文件名'
                      value={uploadForm.filename}
                      onChange={(e) => setUploadForm({ ...uploadForm, filename: e.target.value })}
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label htmlFor='upload-description'>说明（可选）</Label>
                    <Textarea
                      id='upload-description'
                      placeholder='订阅说明信息'
                      value={uploadForm.description}
                      onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant='outline' onClick={() => setUploadDialogOpen(false)}>
                    取消
                  </Button>
                  <Button onClick={handleUpload} disabled={uploadMutation.isPending}>
                    {uploadMutation.isPending ? '上传中...' : '上传'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* 生成订阅 */}
            <Button variant='outline' onClick={() => navigate({ to: '/generator' })}>
              <FileText className='mr-2 h-4 w-4' />
              生成订阅
            </Button>

            {/* 自定义代理组 - 保留入口 */}
            {/* <Link to='/subscribe-files/custom'>
              <Button>
                <Plus className='mr-2 h-4 w-4' />
                自定义代理组
              </Button>
            </Link> */}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>订阅列表 ({files.length})</CardTitle>
            <CardDescription>已添加的订阅文件</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className='text-center py-8 text-muted-foreground'>加载中...</div>
            ) : files.length === 0 ? (
              <div className='text-center py-8 text-muted-foreground'>
                暂无订阅，点击上方按钮添加
              </div>
            ) : (
              <div className='rounded-md border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>订阅名称</TableHead>
                      <TableHead>说明</TableHead>
                      <TableHead>类型</TableHead>
                      <TableHead>文件名</TableHead>
                      <TableHead>最后更新</TableHead>
                      <TableHead className='text-center'>版本</TableHead>
                      <TableHead className='text-center'>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {files.map((file) => (
                      <TableRow key={file.id}>
                        <TableCell className='font-medium'>{file.name}</TableCell>
                        <TableCell>
                          <div className='max-w-[200px] truncate text-sm text-muted-foreground'>
                            {file.description || '-'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant='outline' className={TYPE_COLORS[file.type]}>
                            {TYPE_LABELS[file.type]}
                          </Badge>
                        </TableCell>
                        <TableCell className='font-mono text-sm'>{file.filename}</TableCell>
                        <TableCell className='text-sm text-muted-foreground'>
                          {file.updated_at ? dateFormatter.format(new Date(file.updated_at)) : '-'}
                        </TableCell>
                        <TableCell className='text-center'>
                          {file.latest_version ? (
                            <Badge variant='secondary'>v{file.latest_version}</Badge>
                          ) : (
                            <span className='text-sm text-muted-foreground'>-</span>
                          )}
                        </TableCell>
                        <TableCell className='text-center'>
                          <div className='flex items-center justify-center gap-2'>
                            <Button
                              variant='ghost'
                              size='sm'
                              onClick={() => handleEditMetadata(file)}
                              disabled={updateMetadataMutation.isPending}
                            >
                              <Settings className='mr-1 h-4 w-4' />
                              编辑信息
                            </Button>
                            <Button
                              variant='ghost'
                              size='sm'
                              onClick={() => handleEditConfig(file)}
                            >
                              <Edit className='mr-1 h-4 w-4' />
                              编辑配置
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant='ghost'
                                  size='sm'
                                  disabled={deleteMutation.isPending}
                                >
                                  删除
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>确认删除</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    确定要删除订阅 "{file.name}" 吗？此操作将同时删除对应的文件，不可撤销。
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>取消</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDelete(file.id)}>
                                    删除
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* 编辑文件 Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={(open) => {
        setEditDialogOpen(open)
        if (!open) {
          // 关闭对话框时清理状态
          setEditingFile(null)
          setEditorValue('')
          setIsDirty(false)
          setValidationError(null)
        }
      }}>
        <DialogContent className='max-w-4xl h-[90vh] flex flex-col p-0'>
          <DialogHeader className='px-6 pt-6'>
            <DialogTitle>{editingFile?.name || '编辑文件'}</DialogTitle>
            <DialogDescription>
              编辑 {editingFile?.filename} 的内容，会自动验证 YAML 格式
            </DialogDescription>
          </DialogHeader>

          <div className='flex-1 flex flex-col overflow-hidden px-6'>
            <div className='flex items-center gap-3 py-4'>
              <Button
                size='sm'
                onClick={handleSave}
                disabled={!editingFile || !isDirty || saveMutation.isPending || fileContentQuery.isLoading}
              >
                {saveMutation.isPending ? '保存中...' : '保存修改'}
              </Button>
              <Button
                size='sm'
                variant='outline'
                disabled={!isDirty || fileContentQuery.isLoading || saveMutation.isPending}
                onClick={handleReset}
              >
                还原修改
              </Button>
              {fileContentQuery.data?.latest_version ? (
                <Badge variant='secondary'>版本 v{fileContentQuery.data.latest_version}</Badge>
              ) : null}
            </div>

            {validationError ? (
              <div className='rounded-md border border-destructive/60 bg-destructive/10 p-3 text-sm text-destructive mb-4'>
                {validationError}
              </div>
            ) : null}

            <div className='flex-1 rounded-lg border bg-muted/20 overflow-hidden mb-4'>
              {fileContentQuery.isLoading ? (
                <div className='p-4 text-center text-muted-foreground'>加载中...</div>
              ) : (
                <Textarea
                  value={editorValue}
                  onChange={(event) => {
                    const nextValue = event.target.value
                    setEditorValue(nextValue)
                    setIsDirty(nextValue !== (fileContentQuery.data?.content ?? ''))
                    if (validationError) {
                      setValidationError(null)
                    }
                  }}
                  className='w-full h-full font-mono text-sm resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0'
                  disabled={!editingFile || saveMutation.isPending}
                  spellCheck={false}
                />
              )}
            </div>
          </div>

          <DialogFooter className='px-6 pb-6'>
            <Button variant='outline' onClick={() => setEditDialogOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑订阅信息 Dialog */}
      <Dialog open={editMetadataDialogOpen} onOpenChange={(open) => {
        setEditMetadataDialogOpen(open)
        if (!open) {
          setEditingMetadata(null)
          setMetadataForm({ name: '', description: '', filename: '' })
        }
      }}>
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>编辑订阅信息</DialogTitle>
            <DialogDescription>
              修改订阅名称、说明和文件名
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4 py-4'>
            <div className='space-y-2'>
              <Label htmlFor='metadata-name'>订阅名称 *</Label>
              <Input
                id='metadata-name'
                value={metadataForm.name}
                onChange={(e) => setMetadataForm({ ...metadataForm, name: e.target.value })}
                placeholder='例如：机场A'
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='metadata-description'>说明（可选）</Label>
              <Textarea
                id='metadata-description'
                value={metadataForm.description}
                onChange={(e) => setMetadataForm({ ...metadataForm, description: e.target.value })}
                placeholder='订阅说明信息'
                rows={3}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='metadata-filename'>文件名 *</Label>
              <Input
                id='metadata-filename'
                value={metadataForm.filename}
                onChange={(e) => setMetadataForm({ ...metadataForm, filename: e.target.value })}
                placeholder='例如：subscription.yaml'
              />
              <p className='text-xs text-muted-foreground'>
                修改文件名后需确保该文件在 subscribes 目录中存在
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setEditMetadataDialogOpen(false)}
              disabled={updateMetadataMutation.isPending}
            >
              取消
            </Button>
            <Button
              onClick={handleUpdateMetadata}
              disabled={updateMetadataMutation.isPending}
            >
              {updateMetadataMutation.isPending ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑配置对话框 */}
      <Dialog open={editConfigDialogOpen} onOpenChange={(open) => {
        setEditConfigDialogOpen(open)
        if (!open) {
          setEditingConfigFile(null)
          setConfigContent('')
        }
      }}>
        <DialogContent className='!max-w-[80vw] w-[80vw] max-h-[90vh] flex flex-col'>
          <DialogHeader>
            <DialogTitle>编辑配置 - {editingConfigFile?.name}</DialogTitle>
            <DialogDescription>
              {editingConfigFile?.filename}
            </DialogDescription>
            <div className='flex items-center justify-end gap-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => handleEditNodes(editingConfigFile!)}
              >
                <Edit className='mr-2 h-4 w-4' />
                编辑节点
              </Button>
              <Button
                size='sm'
                onClick={handleSaveConfig}
                disabled={saveConfigMutation.isPending}
              >
                <Save className='mr-2 h-4 w-4' />
                {saveConfigMutation.isPending ? '保存中...' : '保存'}
              </Button>
            </div>
          </DialogHeader>
          <div className='flex-1 overflow-y-auto space-y-4'>

            <div className='rounded-lg border bg-muted/30'>
              <Textarea
                value={configContent}
                onChange={(e) => setConfigContent(e.target.value)}
                className='min-h-[400px] resize-none border-0 bg-transparent font-mono text-xs'
                placeholder='加载配置中...'
              />
            </div>
            <div className='flex justify-end gap-2'>
              <Button onClick={handleSaveConfig} disabled={saveConfigMutation.isPending}>
                <Save className='mr-2 h-4 max-w-md' />
                {saveConfigMutation.isPending ? '保存中...' : '保存'}
              </Button>
            </div>
            <div className='rounded-lg border bg-muted/50 p-4'>
              <h3 className='mb-2 font-semibold'>使用说明</h3>
              <ul className='space-y-1 text-sm text-muted-foreground'>
                <li>• 点击"保存"按钮将修改保存到配置文件</li>
                <li>• 支持直接编辑 YAML 内容</li>
                <li>• 保存前会自动验证 YAML 格式</li>
                <li>• 支持 Clash、Clash Meta、Mihomo 等客户端</li>
              </ul>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 编辑节点对话框 */}
      <Dialog open={editNodesDialogOpen} onOpenChange={(open) => {
        setEditNodesDialogOpen(open)
        if (!open) {
          setEditingNodesFile(null)
          setProxyGroups([])
          setShowAllNodes(false)
        }
      }}>
        <DialogContent className='!max-w-[95vw] w-[95vw] max-h-[90vh] flex flex-col' style={{ maxWidth: '95vw', width: '95vw' }}>
          <DialogHeader>
            <DialogTitle>编辑节点 - {editingNodesFile?.name}</DialogTitle>
            <DialogDescription>
              拖拽节点到不同的代理组，自定义每个组的节点列表
            </DialogDescription>
          </DialogHeader>
          <div className='flex-1 overflow-y-auto py-4'>
            <div className='flex gap-4 h-full'>
              {/* 左侧：代理组 */}
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
                          <div
                            draggable
                            onDragStart={() => handleDragStart(group.name, null, -1)}
                            onDragEnd={handleDragEnd}
                            className='flex items-center gap-2 cursor-move group/title'
                          >
                            <GripVertical className='h-3 w-3 text-muted-foreground opacity-0 group-hover/title:opacity-100 transition-opacity flex-shrink-0' />
                            <CardTitle className='text-base truncate'>{group.name}</CardTitle>
                          </div>
                          <CardDescription className='text-xs'>
                            {group.type} ({(group.proxies || []).length} 个节点)
                          </CardDescription>
                        </div>
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
                            className='flex items-center gap-2 p-2 rounded border hover:border-border hover:bg-accent cursor-move transition-colors duration-75'
                          >
                            <GripVertical className='h-4 w-4 text-muted-foreground flex-shrink-0' />
                            <span className='text-sm truncate flex-1'>{proxy}</span>
                            <Button
                              variant='ghost'
                              size='sm'
                              className='h-6 w-6 p-0 flex-shrink-0'
                              onClick={(e) => {
                                e.stopPropagation()
                                handleRemoveNodeFromGroup(group.name, idx)
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
              <div className='w-1 bg-border flex-shrink-0'></div>

              {/* 右侧：可用节点 */}
              <div className='w-64 flex-shrink-0 flex flex-col h-full'>
                {/* 操作按钮 */}
                <div className='flex-shrink-0 mb-4'>
                  <div className='flex gap-2'>
                    <Button variant='outline' onClick={() => setEditNodesDialogOpen(false)} className='flex-1'>
                      取消
                    </Button>
                    <Button onClick={handleSaveNodes} className='flex-1' disabled={saveConfigMutation.isPending}>
                      {saveConfigMutation.isPending ? '保存中...' : '应用并保存'}
                    </Button>
                  </div>
                </div>

                {/* 显示/隐藏已添加节点按钮 */}
                <div className='flex-shrink-0 mb-4'>
                  <Button
                    variant='outline'
                    className='w-full'
                    onClick={() => setShowAllNodes(!showAllNodes)}
                  >
                    {showAllNodes ? '隐藏已添加节点' : '显示已添加节点'}
                  </Button>
                </div>

                <div className='flex-1 overflow-y-auto min-h-0'>
                  <Card
                    className={`transition-all duration-75 ${
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
                      <div
                        draggable
                        onDragStart={() => handleDragStart('__AVAILABLE_NODES__', 'available', -1)}
                        onDragEnd={handleDragEnd}
                        className='flex items-center gap-2 cursor-move'
                      >
                        <GripVertical className='h-4 w-4 text-muted-foreground flex-shrink-0' />
                        <div>
                          <CardTitle className='text-base'>可用节点</CardTitle>
                          <CardDescription className='text-xs'>
                            {availableNodes.length} 个节点
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className='space-y-1'>
                      {availableNodes.map((proxy, idx) => (
                        <div
                          key={`available-${proxy}-${idx}`}
                          draggable
                          onDragStart={() => handleDragStart(proxy, 'available', idx)}
                          onDragEnd={handleDragEnd}
                          className='flex items-center gap-2 p-2 rounded border hover:border-border hover:bg-accent cursor-move transition-colors duration-75'
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
          </div>
        </DialogContent>
      </Dialog>
    </main>
  )
}
