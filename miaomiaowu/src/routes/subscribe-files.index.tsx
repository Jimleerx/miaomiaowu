// @ts-nocheck
import { useState, useEffect, useMemo } from 'react'
import { createFileRoute, redirect, Link } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { load as parseYAML } from 'js-yaml'
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
import { Upload, Download, Plus, Edit, Settings } from 'lucide-react'

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

  // 编辑器状态
  const [editorValue, setEditorValue] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

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
      const response = await api.get(`/api/rules/${encodeURIComponent(editingFile.filename)}`)
      return response.data as {
        name: string
        content: string
        latest_version: number
      }
    },
    enabled: Boolean(editingFile && auth.accessToken),
    refetchOnWindowFocus: false,
  })

  // 保存文件
  const saveMutation = useMutation({
    mutationFn: async (payload: { file: string; content: string }) => {
      const response = await api.put(`/api/rules/${encodeURIComponent(payload.file)}`, {
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
                              onClick={() => handleEdit(file)}
                            >
                              <Edit className='mr-1 h-4 w-4' />
                              编辑内容
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
    </main>
  )
}
