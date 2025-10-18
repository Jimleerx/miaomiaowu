// @ts-nocheck
import { useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Activity, HardDrive, PieChart, TrendingUp } from 'lucide-react'
import { Topbar } from '@/components/layout/topbar'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import { handleServerError } from '@/lib/handle-server-error'

// @ts-ignore - retained simple route definition
export const Route = createFileRoute('/')({
  component: DashboardPage,
})

function DashboardPage() {
  const { auth } = useAuthStore()
  const token = auth.accessToken

  const numberFormatter = useMemo(
    () =>
      new Intl.NumberFormat('zh-CN', {
        maximumFractionDigits: 2,
        minimumFractionDigits: 0,
      }),
    []
  )

  // Check if initial setup is needed
  const { data: setupStatus, isLoading: isCheckingSetup } = useQuery({
    queryKey: ['setup-status'],
    queryFn: async () => {
      const response = await api.get('/api/setup/status')
      return response.data as { needs_setup: boolean }
    },
    staleTime: Infinity,
    enabled: !token,
  })

  const { data, isLoading, isError } = useQuery({
    queryKey: ['traffic-summary'],
    queryFn: async () => {
      const response = await api.get('/api/traffic/summary')
      return response.data
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    enabled: Boolean(token),
  })

  const metrics = data?.metrics ?? {}

  const cards = useMemo(
    () => [
      {
        title: '总流量配额',
        description: '全部服务器的可用总配额',
        value: formatMetric(metrics.total_limit_gb, numberFormatter),
        icon: TrendingUp,
      },
      {
        title: '已用流量',
        description: '截止今日的累计消耗',
        value: formatMetric(metrics.total_used_gb, numberFormatter),
        icon: Activity,
      },
      {
        title: '剩余流量',
        description: '仍可分配的余量',
        value: formatMetric(metrics.total_remaining_gb, numberFormatter),
        icon: HardDrive,
      },
      {
        title: '使用率',
        description: '累计使用占比',
        value: formatPercentage(metrics.usage_percentage, numberFormatter),
        progress: Number(metrics.usage_percentage ?? 0),
        icon: PieChart,
      },
    ],
    [metrics, numberFormatter]
  )

  const chartData = useMemo(() => {
    return (data?.history ?? []).map((item: any) => ({
      date: item.date,
      label: item.date.slice(5),
      used: Number(item.used_gb ?? 0),
    }))
  }, [data])

  const hasHistory = chartData.length > 0

  if (!token) {
    // Show setup page if needed, otherwise show login
    if (isCheckingSetup) {
      return (
        <div className='flex min-h-svh items-center justify-center bg-background'>
          <Card className='w-full max-w-sm'>
            <CardHeader className='space-y-2 text-center'>
              <CardTitle>加载中...</CardTitle>
              <CardDescription>正在检查系统状态</CardDescription>
            </CardHeader>
          </Card>
        </div>
      )
    }

    if (setupStatus?.needs_setup) {
      return <InitialSetupView />
    }

    return <LoginView />
  }

  return (
    <div className='min-h-svh bg-background'>
      <Topbar />
      <main className='mx-auto w-full max-w-5xl px-4 py-8 sm:px-6'>

        <section className='mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
          {isLoading
            ? Array.from({ length: 4 }).map((_, index) => (
                <Card key={index}>
                  <CardHeader className='space-y-2'>
                    <CardTitle className='flex flex-row items-center justify-between text-base'>
                      <Skeleton className='h-5 w-24' />
                      <Skeleton className='h-10 w-10 rounded-full' />
                    </CardTitle>
                    <CardDescription>
                      <Skeleton className='h-4 w-32' />
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Skeleton className='h-9 w-28' />
                  </CardContent>
                </Card>
              ))
            : cards.map(({ title, description, value, icon: Icon, progress }) => (
                <Card key={title}>
                  <CardHeader className='space-y-2'>
                    <CardTitle className='flex flex-row items-center justify-between text-base'>
                      {title}
                      <Icon className='size-8 text-primary' />
                    </CardTitle>
                    <CardDescription>{description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className='text-3xl font-semibold'>{value}</div>
                    {typeof progress === 'number' && !Number.isNaN(progress) ? (
                      <div className='mt-4 space-y-2'>
                        <Progress value={Math.min(Math.max(progress, 0), 100)} max={100} />
                        <div className='text-xs text-muted-foreground'>
                          已使用 {numberFormatter.format(progress)}%
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
        </section>

        <Card className='mt-8'>
          <CardHeader>
            <CardTitle>每日流量消耗</CardTitle>
            <CardDescription>最近记录的日度流量趋势</CardDescription>
          </CardHeader>
          <CardContent className='pt-0'>
            <div className='h-80'>
              {isLoading ? (
                <div className='flex h-full items-center justify-center'>
                  <Skeleton className='h-32 w-full max-w-3xl' />
                </div>
              ) : !hasHistory ? (
                <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
                  {isError ? '数据加载失败，请稍后重试。' : '暂无历史记录。'}
                </div>
              ) : (
                <ResponsiveContainer width='100%' height='100%'>
                  <AreaChart data={chartData} margin={{ left: 16, right: 16, top: 24, bottom: 8 }}>
                    <defs>
                      <linearGradient id='dailyUsageGradient' x1='0' y1='0' x2='0' y2='1'>
                        <stop offset='5%' stopColor='hsl(var(--primary))' stopOpacity={0.5} />
                        <stop offset='95%' stopColor='hsl(var(--primary))' stopOpacity={0.1} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray='3 3' className='stroke-border' />
                    <XAxis
                      dataKey='label'
                      tickLine={false}
                      axisLine={false}
                      className='fill-foreground'
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value: number) => `${numberFormatter.format(value)}`}
                      className='fill-foreground'
                    />
                    <Tooltip
                      cursor={{ strokeDasharray: '3 3', stroke: 'hsl(var(--primary))' }}
                      labelFormatter={(label: string) => `日期：${chartData.find((item) => item.label === label)?.date ?? label}`}
                      formatter={(value: number) => [`${numberFormatter.format(value)} GB`, '日消耗']}
                      contentStyle={{
                        backgroundColor: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 'var(--radius)',
                      }}
                      labelStyle={{ color: 'hsl(var(--foreground))' }}
                    />
                    <Area
                      type='monotone'
                      dataKey='used'
                      stroke='hsl(var(--primary))'
                      fill='url(#dailyUsageGradient)'
                      strokeWidth={3}
                      name='日消耗'
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

type LoginFormValues = {
  username: string
  password: string
  remember_me: boolean
}

type SetupFormValues = {
  username: string
  password: string
  nickname: string
  email: string
  avatar_url: string
}

function LoginView() {
  const queryClient = useQueryClient()
  const { auth } = useAuthStore()
  const form = useForm<LoginFormValues>({
    defaultValues: {
      username: '',
      password: '',
      remember_me: false,
    },
  })

  const login = useMutation({
    mutationFn: async (values: LoginFormValues) => {
      const response = await api.post('/api/login', values)
      return response.data as {
        token: string
        expires_at: string
        username: string
        email: string
        nickname: string
        role: string
        is_admin: boolean
      }
    },
    onSuccess: (payload) => {
      auth.setAccessToken(payload.token)
      queryClient.invalidateQueries({ queryKey: ['traffic-summary'] })
      queryClient.setQueryData(['profile'], {
        username: payload.username,
        email: payload.email,
        nickname: payload.nickname,
        role: payload.role,
        is_admin: payload.is_admin,
      })
      toast.success('登录成功')
      form.reset()
    },
    onError: (error) => {
      handleServerError(error)
      toast.error('登录失败，请检查账号或密码')
    },
  })

  const onSubmit = form.handleSubmit((values) => {
    login.mutate(values)
  })

  return (
    <div className='flex min-h-svh items-center justify-center bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-background via-muted/40 to-muted/60 px-4 py-12'>
      <Card className='w-full max-w-sm shadow-lg'>
        <CardHeader className='space-y-2 text-center'>
          <CardTitle className='text-2xl font-semibold'>登录妙妙屋</CardTitle>
          <CardDescription>请输入管理员账号以访问控制台。</CardDescription>
        </CardHeader>
        <CardContent>
          <form className='space-y-6' onSubmit={onSubmit}>
            <div className='space-y-2'>
              <Label htmlFor='username'>用户名</Label>
              <Input
                id='username'
                type='text'
                autoCapitalize='none'
                autoComplete='username'
                autoFocus
                placeholder='请输入用户名'
                {...form.register('username', { required: true })}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='password'>密码</Label>
              <Input
                id='password'
                type='password'
                autoComplete='current-password'
                placeholder='请输入密码'
                {...form.register('password', { required: true })}
              />
            </div>
            <div className='flex items-center space-x-2'>
              <Checkbox
                id='remember_me'
                checked={form.watch('remember_me')}
                onCheckedChange={(checked) => form.setValue('remember_me', checked === true)}
              />
              <Label htmlFor='remember_me' className='text-sm font-normal cursor-pointer'>
                记住我
              </Label>
            </div>
            <Button type='submit' className='w-full' disabled={login.isPending}>
              {login.isPending ? '登录中...' : '登录'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function formatMetric(value: number | undefined, formatter: Intl.NumberFormat) {
  if (value === undefined || value === null) return '--'
  let unit = 'GB'
  let displayValue = value

  if (value >= 1024) {
    displayValue = value / 1024
    unit = 'TB'
  }

  return `${formatter.format(displayValue)} ${unit}`
}

function formatPercentage(value: number | undefined, formatter: Intl.NumberFormat) {
  if (value === undefined || value === null) return '--'
  return `${formatter.format(value)} %`
}

function InitialSetupView() {
  const queryClient = useQueryClient()
  const form = useForm<SetupFormValues>({
    defaultValues: {
      username: '',
      password: '',
      nickname: '',
      email: '',
      avatar_url: '',
    },
  })

  const setup = useMutation({
    mutationFn: async (values: SetupFormValues) => {
      const response = await api.post('/api/setup/init', values)
      return response.data as {
        username: string
        nickname: string
        email: string
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setup-status'] })
      toast.success('首次初始化成功！请使用刚才创建的账号登录。')
      form.reset()
    },
    onError: (error) => {
      handleServerError(error)
      toast.error('初始化失败，请重试')
    },
  })

  const onSubmit = form.handleSubmit((values) => {
    setup.mutate(values)
  })

  return (
    <div className='flex min-h-svh items-center justify-center bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-background via-muted/40 to-muted/60 px-4 py-12'>
      <Card className='w-full max-w-md shadow-lg'>
        <CardHeader className='space-y-2 text-center'>
          <CardTitle className='text-2xl font-semibold'>欢迎使用妙妙屋</CardTitle>
          <CardDescription>
            这是首次启动，请创建管理员账号。首次注册的用户将自动成为管理员。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className='space-y-4' onSubmit={onSubmit}>
            <div className='space-y-2'>
              <Label htmlFor='setup-username'>
                用户名 <span className='text-destructive'>*</span>
              </Label>
              <Input
                id='setup-username'
                type='text'
                autoCapitalize='none'
                autoComplete='username'
                autoFocus
                placeholder='请输入用户名'
                {...form.register('username', { required: true })}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='setup-password'>
                密码 <span className='text-destructive'>*</span>
              </Label>
              <Input
                id='setup-password'
                type='password'
                autoComplete='new-password'
                placeholder='请输入密码'
                {...form.register('password', { required: true })}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='setup-nickname'>昵称</Label>
              <Input
                id='setup-nickname'
                type='text'
                autoComplete='name'
                placeholder='留空则使用用户名'
                {...form.register('nickname')}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='setup-email'>邮箱</Label>
              <Input
                id='setup-email'
                type='email'
                autoComplete='email'
                placeholder='可选'
                {...form.register('email')}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='setup-avatar'>头像地址</Label>
              <Input
                id='setup-avatar'
                type='url'
                placeholder='可选，填写头像图片URL'
                {...form.register('avatar_url')}
              />
            </div>
            <Button type='submit' className='w-full' disabled={setup.isPending}>
              {setup.isPending ? '创建中...' : '创建管理员账号'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
