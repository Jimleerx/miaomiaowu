// @ts-nocheck
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Topbar } from '@/components/layout/topbar'
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import { profileQueryFn } from '@/lib/profile'
import { useAuthStore } from '@/stores/auth-store'

// @ts-ignore - retained simple route definition
export const Route = createFileRoute('/users')({
  beforeLoad: () => {
    const token = useAuthStore.getState().auth.accessToken
    if (!token) {
      throw redirect({ to: '/' })
    }
  },
  component: UsersPage,
})

type UserRow = {
  username: string
  email: string
  nickname: string
  role: string
  is_active: boolean
}

type ResetState = {
  username: string
  password: string
}

type CreateState = {
  username: string
  email: string
  nickname: string
  password: string
  subscriptionIds: number[]
}

type SubscriptionManageState = {
  username: string
  selectedIds: number[]
  initialized: boolean
}

type SubscribeFile = {
  id: number
  name: string
  description?: string
  type: string
  filename: string
  url: string
  created_at?: string
  updated_at?: string
}

const generatePassword = (length = 12) => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
}

function UsersPage() {
  const { auth } = useAuthStore()
  const queryClient = useQueryClient()
  const [resetState, setResetState] = useState<ResetState | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createState, setCreateState] = useState<CreateState>({
    username: '',
    email: '',
    nickname: '',
    password: generatePassword(),
    subscriptionIds: [],
  })
  const [subscriptionManageState, setSubscriptionManageState] = useState<SubscriptionManageState | null>(null)

  const { data: profile, isLoading: profileLoading, isError: profileError } = useQuery({
    queryKey: ['profile'],
    queryFn: profileQueryFn,
    enabled: Boolean(auth.accessToken),
    staleTime: 5 * 60 * 1000,
  })

  const isAdmin = Boolean(profile?.is_admin)

  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const response = await api.get('/api/admin/users')
      return response.data as { users: UserRow[] }
    },
    enabled: Boolean(isAdmin && auth.accessToken),
    staleTime: 30 * 1000,
  })

  const subscriptionsQuery = useQuery({
    queryKey: ['admin-all-subscriptions'],
    queryFn: async () => {
      const response = await api.get('/api/subscriptions')
      return response.data?.subscriptions ?? []
    },
    enabled: Boolean(isAdmin && auth.accessToken),
    staleTime: 60 * 1000,
  })

  const userSubscriptionsQuery = useQuery({
    queryKey: ['user-subscriptions', subscriptionManageState?.username],
    queryFn: async () => {
      if (!subscriptionManageState?.username) return { subscription_ids: [] }
      const response = await api.get(`/api/admin/users/${subscriptionManageState.username}/subscriptions`)
      return response.data as { subscription_ids: number[] }
    },
    enabled: Boolean(subscriptionManageState?.username && isAdmin && auth.accessToken),
    staleTime: 30 * 1000,
  })

  const statusMutation = useMutation({
    mutationFn: async (payload: { username: string; is_active: boolean }) => {
      await api.post('/api/admin/users/status', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success('用户状态已更新')
    },
    onError: handleServerError,
  })

  const resetMutation = useMutation({
    mutationFn: async (payload: ResetState) => {
      const response = await api.post('/api/admin/users/reset-password', {
        username: payload.username,
        new_password: payload.password,
      })
      return response.data as { username: string; password: string }
    },
    onSuccess: (data) => {
      toast.success('密码已重置')
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setResetState(null)

      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(data.password).catch(() => null)
      }
    },
    onError: (error) => {
      handleServerError(error)
    },
  })

  const createMutation = useMutation({
    mutationFn: async (payload: CreateState) => {
      // 创建用户
      const response = await api.post('/api/admin/users/create', {
        username: payload.username,
        email: payload.email,
        nickname: payload.nickname,
        password: payload.password,
      })
      const userData = response.data as { username: string; email: string; nickname: string; role: string; password: string }

      // 如果选择了订阅，分配给用户
      if (payload.subscriptionIds.length > 0) {
        await api.put(`/api/admin/users/${userData.username}/subscriptions`, {
          subscription_ids: payload.subscriptionIds,
        })
      }

      return userData
    },
    onSuccess: (data) => {
      toast.success('用户已创建，初始密码已复制')
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setCreateOpen(false)
      setCreateState({ username: '', email: '', nickname: '', password: generatePassword(), subscriptionIds: [] })

      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(data.password).catch(() => null)
      }
    },
    onError: (error) => {
      handleServerError(error)
    },
  })

  const updateSubscriptionsMutation = useMutation({
    mutationFn: async (payload: { username: string; subscription_ids: number[] }) => {
      await api.put(`/api/admin/users/${payload.username}/subscriptions`, {
        subscription_ids: payload.subscription_ids,
      })
    },
    onSuccess: (_, variables) => {
      toast.success('订阅已更新')
      queryClient.invalidateQueries({ queryKey: ['user-subscriptions', variables.username] })
      setSubscriptionManageState(null)
    },
    onError: handleServerError,
  })

  const toggleSubscriptionSelection = (id: number, nextState?: boolean) => {
    setSubscriptionManageState((prev) => {
      if (!prev) return prev
      const alreadySelected = prev.selectedIds.includes(id)
      const shouldSelect = typeof nextState === 'boolean' ? nextState : !alreadySelected
      if (shouldSelect === alreadySelected) {
        if (!prev.initialized) {
          return { ...prev, initialized: true }
        }
        return prev
      }
      const selectedIds = shouldSelect
        ? [...prev.selectedIds, id]
        : prev.selectedIds.filter((existingId) => existingId !== id)
      return { ...prev, selectedIds, initialized: true }
    })
  }

  const users = useMemo(() => usersQuery.data?.users ?? [], [usersQuery.data])

  useEffect(() => {
    if (!subscriptionManageState || subscriptionManageState.initialized) return
    if (!userSubscriptionsQuery.isSuccess) return
    const serverIds = userSubscriptionsQuery.data?.subscription_ids ?? []
    setSubscriptionManageState((prev) => {
      if (!prev || prev.initialized || prev.username !== subscriptionManageState.username) {
        return prev
      }
      return { ...prev, selectedIds: serverIds, initialized: true }
    })
  }, [subscriptionManageState, userSubscriptionsQuery.isSuccess, userSubscriptionsQuery.data])

  if (profileLoading) {
    return (
      <div className='min-h-svh bg-background'>
        <Topbar />
        <main className='mx-auto w-full max-w-5xl px-4 py-8 sm:px-6'>
          <Card className='shadow-none border-dashed'>
            <CardHeader>
              <CardTitle>加载中…</CardTitle>
              <CardDescription>正在获取管理员信息，请稍候。</CardDescription>
            </CardHeader>
            <CardContent>
              <div className='space-y-3'>
                <div className='h-10 w-full rounded-md bg-muted animate-pulse' />
                <div className='h-10 w-full rounded-md bg-muted animate-pulse' />
                <div className='h-10 w-full rounded-md bg-muted animate-pulse' />
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
          <Card className='w-full shadow-none border-dashed'>
            <CardHeader>
              <CardTitle>权限不足</CardTitle>
              <CardDescription>只有管理员可以访问用户管理页面。</CardDescription>
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
        <section className='space-y-3'>
          <h1 className='text-3xl font-semibold tracking-tight'>用户管理</h1>
          <p className='text-muted-foreground'>查看系统用户，调整启用状态并重置密码。</p>
        </section>

        <Card className='mt-8'>
          <CardHeader>
            <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
              <div>
                <CardTitle>账号列表</CardTitle>
                <CardDescription>仅管理员可更改用户状态或重置密码。</CardDescription>
              </div>
              <Button
                size='sm'
                onClick={() => {
                  setCreateState({ username: '', email: '', nickname: '', password: generatePassword(), subscriptionIds: [] })
                  setCreateOpen(true)
                }}
              >
                新增用户
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className='overflow-x-auto'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='w-[160px]'>用户名</TableHead>
                    <TableHead className='w-[160px]'>昵称</TableHead>
                    <TableHead className='w-[200px]'>邮箱</TableHead>
                    <TableHead className='w-[100px] text-center'>角色</TableHead>
                    <TableHead className='w-[100px] text-center'>状态</TableHead>
                    <TableHead className='w-[280px] text-right'>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => {
                    const isSelf = user.username === profile?.username
                    const isAdminRow = user.role === 'admin'
                    return (
                      <TableRow key={user.username}>
                        <TableCell className='font-medium'>{user.username}</TableCell>
                        <TableCell>{user.nickname || '—'}</TableCell>
                        <TableCell className='text-muted-foreground'>{user.email || '—'}</TableCell>
                        <TableCell className='text-center'>
                          <span className='text-sm font-medium'>{isAdminRow ? '管理员' : '普通用户'}</span>
                        </TableCell>
                        <TableCell className='text-center'>
                          <Switch
                            checked={user.is_active}
                            disabled={statusMutation.isPending || isSelf || isAdminRow}
                            onCheckedChange={(checked) =>
                              statusMutation.mutate({
                                username: user.username,
                                is_active: checked,
                              })
                            }
                          />
                        </TableCell>
                        <TableCell className='text-right'>
                          {isAdminRow ? (
                            <span className='text-sm text-muted-foreground'>—</span>
                          ) : (
                            <div className='flex items-center justify-end gap-2'>
                              <Button
                                size='sm'
                                variant='outline'
                                disabled={resetMutation.isPending}
                                onClick={() =>
                                  setResetState({
                                    username: user.username,
                                    password: generatePassword(),
                                  })
                                }
                              >
                                重置密码
                              </Button>
                              <Button
                                size='sm'
                                variant='outline'
                                onClick={() =>
                                  setSubscriptionManageState({
                                    username: user.username,
                                    selectedIds: [],
                                    initialized: false,
                                  })
                                }
                              >
                                管理订阅
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {users.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className='py-10 text-center text-muted-foreground'>
                        当前没有可显示的用户。
                      </TableCell>
                    </TableRow>
                  ) : null}
      <Dialog open={createOpen} onOpenChange={(open) => setCreateOpen(open)}>
        <DialogContent className='sm:max-w-lg max-h-[90vh] overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>新增用户</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='create-username'>用户名</Label>
              <Input
                id='create-username'
                value={createState.username}
                autoComplete='off'
                onChange={(event) =>
                  setCreateState((prev) => {
                    const value = event.target.value
                    const shouldSyncNickname = prev.nickname === '' || prev.nickname === prev.username
                    return {
                      ...prev,
                      username: value,
                      nickname: shouldSyncNickname ? value : prev.nickname,
                    }
                  })
                }
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='create-email'>邮箱</Label>
              <Input
                id='create-email'
                type='email'
                value={createState.email}
                autoComplete='off'
                onChange={(event) =>
                  setCreateState((prev) => ({ ...prev, email: event.target.value }))
                }
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='create-nickname'>昵称</Label>
              <Input
                id='create-nickname'
                value={createState.nickname}
                autoComplete='off'
                onChange={(event) =>
                  setCreateState((prev) => ({ ...prev, nickname: event.target.value }))
                }
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='create-password'>初始密码</Label>
              <Input
                id='create-password'
                type='text'
                value={createState.password}
                onChange={(event) =>
                  setCreateState((prev) => ({ ...prev, password: event.target.value }))
                }
              />
              <p className='text-xs text-muted-foreground'>默认生成随机密码，可在创建前自行调整。</p>
            </div>
            <div className='space-y-3'>
              <Label>分配订阅（可选）</Label>
              {subscriptionsQuery.isLoading ? (
                <div className='text-sm text-muted-foreground'>加载订阅列表...</div>
              ) : subscriptionsQuery.data && subscriptionsQuery.data.length > 0 ? (
                <div className='space-y-2 max-h-60 overflow-y-auto border rounded-md p-3'>
                  {subscriptionsQuery.data.map((sub) => (
                    <div key={sub.id} className='flex items-start space-x-3 py-2'>
                      <Checkbox
                        id={`create-sub-${sub.id}`}
                        checked={createState.subscriptionIds.includes(sub.id)}
                        onCheckedChange={(checked) => {
                          setCreateState((prev) => {
                            const newIds = checked
                              ? [...prev.subscriptionIds, sub.id]
                              : prev.subscriptionIds.filter((id) => id !== sub.id)
                            return { ...prev, subscriptionIds: newIds }
                          })
                        }}
                      />
                      <div className='grid gap-1.5 leading-none flex-1'>
                        <label
                          htmlFor={`create-sub-${sub.id}`}
                          className='text-sm font-medium leading-none cursor-pointer'
                        >
                          {sub.name}
                        </label>
                        {sub.description && (
                          <p className='text-sm text-muted-foreground'>{sub.description}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className='text-sm text-muted-foreground'>暂无可用订阅</div>
              )}
            </div>
          </div>
          <DialogFooter className='gap-2'>
            <DialogClose asChild>
              <Button type='button' variant='outline' disabled={createMutation.isPending}>
                取消
              </Button>
            </DialogClose>
            <Button
              type='button'
              disabled={!createState.username || createMutation.isPending}
              onClick={() => createMutation.mutate(createState)}
            >
              {createMutation.isPending ? '创建中…' : '确认创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </main>

      <Dialog open={Boolean(resetState)} onOpenChange={(open) => (open ? null : setResetState(null))}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>重置密码</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label>用户名</Label>
              <Input value={resetState?.username ?? ''} readOnly disabled />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='new-password'>新密码</Label>
              <Input
                id='new-password'
                type='text'
                value={resetState?.password ?? ''}
                onChange={(event) =>
                  setResetState((prev) =>
                    prev
                      ? {
                          ...prev,
                          password: event.target.value,
                        }
                      : prev
                  )
                }
              />
              <p className='text-xs text-muted-foreground'>默认生成随机密码，可自行修改后确认。</p>
            </div>
          </div>
          <DialogFooter className='gap-2'>
            <DialogClose asChild>
              <Button type='button' variant='outline' disabled={resetMutation.isPending}>
                取消
              </Button>
            </DialogClose>
            <Button
              type='button'
              disabled={!resetState?.password || resetMutation.isPending}
              onClick={() => resetState && resetMutation.mutate(resetState)}
            >
              {resetMutation.isPending ? '重置中…' : '确认重置'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(subscriptionManageState)}
        onOpenChange={(open) => {
          if (!open) {
            setSubscriptionManageState(null)
          } else if (subscriptionManageState && userSubscriptionsQuery.data) {
            setSubscriptionManageState((prev) => {
              if (!prev) return prev
              return {
                ...prev,
                selectedIds: userSubscriptionsQuery.data?.subscription_ids ?? [],
                initialized: true,
              }
            })
          }
        }}
      >
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>管理订阅</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label>用户名</Label>
              <Input value={subscriptionManageState?.username ?? ''} readOnly disabled />
            </div>
            <div className='space-y-3'>
              <Label>可用订阅</Label>
              {subscriptionsQuery.isLoading ? (
                <div className='text-sm text-muted-foreground'>加载订阅列表...</div>
              ) : subscriptionsQuery.data && subscriptionsQuery.data.length > 0 ? (
                <div className='space-y-2 max-h-80 overflow-y-auto border rounded-md p-3'>
                  {subscriptionsQuery.data.map((sub) => {
                    const isChecked = subscriptionManageState?.selectedIds.includes(sub.id) ?? false
                    return (
                      <div
                        key={sub.id}
                        role='checkbox'
                        tabIndex={0}
                        aria-checked={isChecked}
                        aria-labelledby={`sub-${sub.id}-label`}
                        className='flex cursor-pointer items-start space-x-3 rounded-md px-3 py-2 transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
                        onClick={() => toggleSubscriptionSelection(sub.id)}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) {
                            return
                          }
                          if (event.key === ' ' || event.key === 'Enter') {
                            event.preventDefault()
                            toggleSubscriptionSelection(sub.id)
                          }
                        }}
                      >
                        <div onClick={(event) => event.stopPropagation()} className='pt-0.5'>
                          <Checkbox
                            id={`sub-${sub.id}`}
                            checked={isChecked}
                            onCheckedChange={(checked) => toggleSubscriptionSelection(sub.id, checked === true)}
                          />
                        </div>
                        <div className='grid gap-1.5 leading-none flex-1'>
                          <label
                            id={`sub-${sub.id}-label`}
                            className='text-sm font-medium leading-none cursor-pointer'
                          >
                            {sub.name}
                          </label>
                          {sub.description && (
                            <p className='text-sm text-muted-foreground'>{sub.description}</p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className='text-sm text-muted-foreground'>暂无可用订阅</div>
              )}
            </div>
          </div>
          <DialogFooter className='gap-2'>
            <DialogClose asChild>
              <Button type='button' variant='outline' disabled={updateSubscriptionsMutation.isPending}>
                取消
              </Button>
            </DialogClose>
            <Button
              type='button'
              disabled={!subscriptionManageState || updateSubscriptionsMutation.isPending}
              onClick={() => {
                if (subscriptionManageState) {
                  updateSubscriptionsMutation.mutate({
                    username: subscriptionManageState.username,
                    subscription_ids: subscriptionManageState.selectedIds,
                  })
                }
              }}
            >
              {updateSubscriptionsMutation.isPending ? '保存中…' : '确认保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
