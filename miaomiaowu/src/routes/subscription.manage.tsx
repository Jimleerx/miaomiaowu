// @ts-nocheck
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Topbar } from '@/components/layout/topbar'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import { profileQueryFn } from '@/lib/profile'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const AVAILABLE_BUTTONS = [
  { id: 'qr', label: '二维码' },
  { id: 'copy', label: '复制' },
  { id: 'import', label: '导入' },
]

const BUTTON_LABEL_MAP = AVAILABLE_BUTTONS.reduce((acc, item) => {
  acc[item.id] = item.label
  return acc
}, {}) as Record<string, string>

type SubscriptionRecord = {
  id: number
  name: string
  description: string
  rule_filename: string
  buttons: string[]
}

type SubscriptionFormState = {
  name: string
  description: string
  buttons: string[]
}

// @ts-ignore - simple route definition retained
export const Route = createFileRoute('/subscription/manage')({
  beforeLoad: () => {
    const token = useAuthStore.getState().auth.accessToken
    if (!token) {
      throw redirect({ to: '/' })
    }
  },
  component: SubscriptionManagePage,
})

function SubscriptionManagePage() {
  const { auth } = useAuthStore()
  const queryClient = useQueryClient()

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<SubscriptionRecord | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SubscriptionRecord | null>(null)
  const [formState, setFormState] = useState<SubscriptionFormState>({
    name: '',
    description: '',
    buttons: AVAILABLE_BUTTONS.map((button) => button.id),
  })
  const [formFile, setFormFile] = useState<File | null>(null)

  const { data: profile, isLoading: profileLoading, isError: profileError } = useQuery({
    queryKey: ['profile'],
    queryFn: profileQueryFn,
    enabled: Boolean(auth.accessToken),
    staleTime: 5 * 60 * 1000,
  })

  const isAdmin = Boolean(profile?.is_admin)

  const { data: subscriptionData, isLoading: subscriptionsLoading } = useQuery({
    queryKey: ['admin-subscriptions'],
    queryFn: async () => {
      const response = await api.get('/api/subscriptions')
      return response.data as { subscriptions: SubscriptionRecord[] }
    },
    enabled: Boolean(auth.accessToken && isAdmin),
    staleTime: 60 * 1000,
  })

  const subscriptions = subscriptionData?.subscriptions ?? []

  const resetForm = () => {
    setFormState({
      name: '',
      description: '',
      buttons: AVAILABLE_BUTTONS.map((button) => button.id),
    })
    setFormFile(null)
  }

  const openCreate = () => {
    resetForm()
    setEditTarget(null)
    setCreateOpen(true)
  }

  const handleToggleButton = (value: string, checked: boolean) => {
    setFormState((prev) => {
      const next = new Set(prev.buttons)
      if (checked) {
        next.add(value)
      } else {
        next.delete(value)
      }
      return { ...prev, buttons: Array.from(next) }
    })
  }

  const openEdit = (record: SubscriptionRecord) => {
    setFormState({
      name: record.name,
      description: record.description,
      buttons: record.buttons ?? [],
    })
    setFormFile(null)
    setEditTarget(record)
  }

  const invalidateSubscriptions = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-subscriptions'] })
    queryClient.invalidateQueries({ queryKey: ['subscriptions'] })
    queryClient.invalidateQueries({ queryKey: ['rule-metadata'] })
  }

  const createMutation = useMutation({
    mutationFn: async (payload: { data: SubscriptionFormState; file: File }) => {
      const formData = new FormData()
      formData.append('name', payload.data.name.trim())
      formData.append('description', payload.data.description.trim())
      for (const button of payload.data.buttons) {
        formData.append('buttons', button)
      }
      formData.append('rule_file', payload.file)
      const response = await api.post('/api/admin/subscriptions', formData)
      return response.data
    },
    onSuccess: () => {
      toast.success('订阅已创建')
      setCreateOpen(false)
      resetForm()
      invalidateSubscriptions()
    },
    onError: handleServerError,
  })

  const updateMutation = useMutation({
    mutationFn: async (payload: { id: number; data: SubscriptionFormState; file: File | null }) => {
      const formData = new FormData()
      formData.append('name', payload.data.name.trim())
      formData.append('description', payload.data.description.trim())
      for (const button of payload.data.buttons) {
        formData.append('buttons', button)
      }
      if (payload.file) {
        formData.append('rule_file', payload.file)
      }
      const response = await api.put(`/api/admin/subscriptions/${payload.id}`, formData)
      return response.data
    },
    onSuccess: () => {
      toast.success('订阅已更新')
      setEditTarget(null)
      resetForm()
      invalidateSubscriptions()
    },
    onError: handleServerError,
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/admin/subscriptions/${id}`)
    },
    onSuccess: () => {
      toast.success('订阅已删除')
      setDeleteTarget(null)
      invalidateSubscriptions()
    },
    onError: handleServerError,
  })

  const handleCreateSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!formState.name.trim()) {
      toast.error('请输入订阅名称')
      return
    }
    if (!formFile) {
      toast.error('请上传规则文件')
      return
    }
    if (formState.buttons.length === 0) {
      toast.error('请至少选择一个功能按钮')
      return
    }
    createMutation.mutate({ data: formState, file: formFile })
  }

  const handleUpdateSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editTarget) {
      return
    }
    if (!formState.name.trim()) {
      toast.error('请输入订阅名称')
      return
    }
    if (formState.buttons.length === 0) {
      toast.error('请至少选择一个功能按钮')
      return
    }
    updateMutation.mutate({ id: editTarget.id, data: formState, file: formFile })
  }

  const handleDelete = () => {
    if (!deleteTarget) {
      return
    }
    deleteMutation.mutate(deleteTarget.id)
  }

  if (profileLoading || subscriptionsLoading) {
    return (
      <div className='min-h-svh bg-background'>
        <Topbar />
        <main className='mx-auto w-full max-w-5xl px-4 py-8 sm:px-6'>
          <Card className='border-dashed shadow-none'>
            <CardHeader>
              <CardTitle>加载中…</CardTitle>
              <CardDescription>正在获取订阅配置，请稍候。</CardDescription>
            </CardHeader>
            <CardContent>
              <div className='space-y-3'>
                <div className='h-10 w-full animate-pulse rounded-md bg-muted' />
                <div className='h-10 w-full animate-pulse rounded-md bg-muted' />
                <div className='h-10 w-full animate-pulse rounded-md bg-muted' />
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    )
  }

  if (!isAdmin || profileError) {
    return (
      <div className='min-h-svh bg-background'>
        <Topbar />
        <main className='mx-auto flex w-full max-w-3xl flex-col items-center justify-center gap-4 px-4 py-20 text-center sm:px-6'>
          <Card className='w-full border-dashed shadow-none'>
            <CardHeader>
              <CardTitle>权限不足</CardTitle>
              <CardDescription>只有管理员可以访问订阅管理页面。</CardDescription>
            </CardHeader>
          </Card>
        </main>
      </div>
    )
  }

  return (
    <div className='min-h-svh bg-background'>
      <Topbar />
      <main className='mx-auto w-full max-w-6xl px-4 py-8 sm:px-6'>
        <section className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
          <div>
            <h1 className='text-3xl font-semibold tracking-tight'>订阅管理</h1>
            <p className='text-muted-foreground'>新增、更新或删除订阅链接，上传规则文件并配置功能按钮。</p>
          </div>
          <Button size='sm' onClick={openCreate} disabled={createMutation.isPending}>
            <Plus className='mr-2 size-4' />新增订阅
          </Button>
        </section>

        <Card className='mt-8'>
          <CardHeader>
            <CardTitle>订阅列表</CardTitle>
            <CardDescription>所有变更会立即影响订阅链接。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className='overflow-x-auto'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='w-[180px]'>名称</TableHead>
                    <TableHead>简介</TableHead>
                    <TableHead className='w-[200px]'>功能按钮</TableHead>
                    <TableHead className='w-[220px]'>规则文件</TableHead>
                    <TableHead className='w-[120px] text-right'>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subscriptions.map((item) => {
                    const labels = (item.buttons ?? []).map((button) => BUTTON_LABEL_MAP[button] ?? button)
                    return (
                      <TableRow key={item.id}>
                        <TableCell className='font-medium'>{item.name}</TableCell>
                        <TableCell className='max-w-[280px] truncate text-muted-foreground'>{item.description || '—'}</TableCell>
                        <TableCell>{labels.length > 0 ? labels.join('、') : '未配置'}</TableCell>
                        <TableCell className='font-mono text-xs text-muted-foreground'>{item.rule_filename}</TableCell>
                        <TableCell className='space-x-2 text-right'>
                          <Button size='icon' variant='outline' className='size-8' onClick={() => openEdit(item)} disabled={updateMutation.isPending}>
                            <Pencil className='size-4' />
                          </Button>
                          <Button size='icon' variant='destructive' className='size-8' onClick={() => setDeleteTarget(item)} disabled={deleteMutation.isPending}>
                            <Trash2 className='size-4' />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {subscriptions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className='py-10 text-center text-muted-foreground'>
                        当前没有订阅记录。
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </main>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) {
            resetForm()
          }
        }}
      >
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>新增订阅</DialogTitle>
            <DialogDescription>配置订阅名称、简介、功能按钮以及规则文件。</DialogDescription>
          </DialogHeader>
          <form className='space-y-4' onSubmit={handleCreateSubmit}>
            <div className='space-y-2'>
              <Label htmlFor='create-name'>名称</Label>
              <Input
                id='create-name'
                value={formState.name}
                onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
                placeholder='例如：clash'
                autoFocus
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='create-description'>简介</Label>
              <Textarea
                id='create-description'
                value={formState.description}
                onChange={(event) => setFormState((prev) => ({ ...prev, description: event.target.value }))}
                rows={3}
              />
            </div>
            <div className='space-y-2'>
              <Label>功能按钮</Label>
              <div className='flex flex-wrap gap-3'>
                {AVAILABLE_BUTTONS.map((button) => (
                  <label key={button.id} className='flex items-center gap-2 text-sm'>
                    <Checkbox
                      checked={formState.buttons.includes(button.id)}
                      onCheckedChange={(checked) => handleToggleButton(button.id, Boolean(checked))}
                    />
                    {button.label}
                  </label>
                ))}
              </div>
              <p className='text-xs text-muted-foreground'>可自由选择展示的按钮，至少保留一个。</p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='create-file'>规则文件</Label>
              <Input
                id='create-file'
                type='file'
                accept='.yaml,.yml'
                onChange={(event) => setFormFile(event.target.files?.[0] ?? null)}
              />
              <p className='text-xs text-muted-foreground'>仅支持 YAML 文件，上传后将自动存储到订阅目录。</p>
            </div>
            <DialogFooter className='gap-2'>
              <DialogClose asChild>
                <Button type='button' variant='outline' disabled={createMutation.isPending}>
                  取消
                </Button>
              </DialogClose>
              <Button type='submit' disabled={createMutation.isPending}>
                {createMutation.isPending ? '创建中…' : '确认创建'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setEditTarget(null)
            resetForm()
          }
        }}
      >
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>编辑订阅</DialogTitle>
            <DialogDescription>更新订阅信息，可选上传新规则文件覆盖旧文件。</DialogDescription>
          </DialogHeader>
          <form className='space-y-4' onSubmit={handleUpdateSubmit}>
            <div className='space-y-2'>
              <Label htmlFor='edit-name'>名称</Label>
              <Input
                id='edit-name'
                value={formState.name}
                onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='edit-description'>简介</Label>
              <Textarea
                id='edit-description'
                value={formState.description}
                onChange={(event) => setFormState((prev) => ({ ...prev, description: event.target.value }))}
                rows={3}
              />
            </div>
            <div className='space-y-2'>
              <Label>功能按钮</Label>
              <div className='flex flex-wrap gap-3'>
                {AVAILABLE_BUTTONS.map((button) => (
                  <label key={button.id} className='flex items-center gap-2 text-sm'>
                    <Checkbox
                      checked={formState.buttons.includes(button.id)}
                      onCheckedChange={(checked) => handleToggleButton(button.id, Boolean(checked))}
                    />
                    {button.label}
                  </label>
                ))}
              </div>
              <p className='text-xs text-muted-foreground'>不勾选的按钮将在订阅卡片中隐藏。</p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='edit-file'>规则文件</Label>
              <Input
                id='edit-file'
                type='file'
                accept='.yaml,.yml'
                onChange={(event) => setFormFile(event.target.files?.[0] ?? null)}
              />
              <p className='text-xs text-muted-foreground'>若不上传则保留原有规则文件。</p>
            </div>
            <DialogFooter className='gap-2'>
              <DialogClose asChild>
                <Button type='button' variant='outline' disabled={updateMutation.isPending}>
                  取消
                </Button>
              </DialogClose>
              <Button type='submit' disabled={updateMutation.isPending}>
                {updateMutation.isPending ? '保存中…' : '保存修改'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
          }
        }}
      >
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确认删除订阅「{deleteTarget?.name}」？关联的规则文件在无其他订阅使用时会被删除。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className='gap-2'>
            <DialogClose asChild>
              <Button type='button' variant='outline' disabled={deleteMutation.isPending}>
                取消
              </Button>
            </DialogClose>
            <Button
              type='button'
              variant='destructive'
              disabled={deleteMutation.isPending}
              onClick={handleDelete}
            >
              {deleteMutation.isPending ? '删除中…' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
