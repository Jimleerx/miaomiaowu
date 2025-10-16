// @ts-nocheck
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { QRCodeCanvas } from 'qrcode.react'
import { Copy, Download, Monitor, Network, QrCode, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
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
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// @ts-ignore - retained simple route definition
export const Route = createFileRoute('/subscription/')({
  beforeLoad: () => {
    const token = useAuthStore.getState().auth.accessToken
    if (!token) {
      throw redirect({ to: '/' })
    }
  },
  component: SubscriptionPage,
})

type RuleMetadataItem = {
  name: string
  latest_version: number
  updated_at?: string
  mod_time: number
}

type SubscriptionRecord = {
  id: number
  name: string
  description: string
  rule_filename: string
  buttons: string[]
}

const ICON_MAP: Record<string, any> = {
  clash: Smartphone,
  'openclash-redirhost': Network,
  'openclash-fakeip': Monitor,
}

function SubscriptionPage() {
  const { auth } = useAuthStore()
  const [qrValue, setQrValue] = useState<string | null>(null)

  const { data: tokenData } = useQuery({
    queryKey: ['user-token'],
    queryFn: async () => {
      const response = await api.get('/api/user/token')
      return response.data as { token: string }
    },
    enabled: Boolean(auth.accessToken),
    staleTime: 5 * 60 * 1000,
  })

  const userToken = tokenData?.token ?? ''

  const { data: subscriptionData } = useQuery({
    queryKey: ['subscriptions'],
    queryFn: async () => {
      const response = await api.get('/api/subscriptions')
      return response.data as { subscriptions: SubscriptionRecord[] }
    },
    enabled: Boolean(auth.accessToken),
    staleTime: 60 * 1000,
  })

  const subscriptions = subscriptionData?.subscriptions ?? []

  const ruleFiles = useMemo(() => {
    const unique = new Set<string>()
    for (const item of subscriptions) {
      if (item.rule_filename) {
        unique.add(item.rule_filename)
      }
    }
    return Array.from(unique)
  }, [subscriptions])

  const { data: ruleMetadata } = useQuery({
    queryKey: ['rule-metadata', ruleFiles],
    queryFn: async () => {
      const params = new URLSearchParams()
      for (const file of ruleFiles) {
        params.append('file', file)
      }
      const response = await api.get(`/api/rules/latest?${params.toString()}`)
      return response.data as {
        rules: Array<{
          name: string
          latest_version: number
          updated_at?: string
          mod_time: number
        }>
      }
    },
    enabled: Boolean(auth.accessToken && ruleFiles.length > 0),
    staleTime: 5 * 60 * 1000,
  })

  const metadataMap = useMemo(() => {
    const map: Record<string, RuleMetadataItem> = {}
    for (const item of ruleMetadata?.rules ?? []) {
      map[item.name] = item
    }
    return map
  }, [ruleMetadata])

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        hour12: false,
      }),
    []
  )

  const baseURL =
    api.defaults.baseURL ??
    (typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.host}`
      : 'http://localhost:8080')

  const buildSubscriptionURL = (name: string) => {
    const url = new URL('/api/clash/subscribe', baseURL)
    if (name) {
      url.searchParams.set('t', name)
    }
    if (userToken) {
      url.searchParams.set('token', userToken)
    }
    return url.toString()
  }

  const handleCopy = async (urlText: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(urlText)
        toast.success('订阅链接已复制')
        return
      } catch (_) {
        // fall through
      }
    }

    toast.error('复制失败，请手动复制')
  }

  return (
    <div className='min-h-svh bg-background'>
      <Topbar />
      <main className='mx-auto w-full max-w-5xl px-4 py-8 sm:px-6'>
        <section className='space-y-4 text-center sm:text-left'>
          <h1 className='text-3xl font-semibold tracking-tight'>订阅链接</h1>
          <p className='text-muted-foreground'>根据客户端选择对应的订阅地址，导入后即可同步最新的配置。</p>
        </section>

        <section className='mt-8 grid gap-6 lg:grid-cols-3'>
          {subscriptions.length === 0 ? (
            <Card className='lg:col-span-3 border-dashed shadow-none'>
              <CardHeader>
                <CardTitle>暂无订阅链接</CardTitle>
                <CardDescription>请联系管理员添加订阅配置。</CardDescription>
              </CardHeader>
            </Card>
          ) : null}

          {subscriptions.map((subscription) => {
            const Icon = ICON_MAP[subscription.name] ?? QrCode
            const subscribeURL = buildSubscriptionURL(subscription.name)
            const clashURL = `clash://install-config?url=${encodeURIComponent(subscribeURL)}`
            const meta = metadataMap[subscription.rule_filename]
            const updatedLabel = meta?.updated_at
              ? dateFormatter.format(new Date(meta.updated_at))
              : meta?.mod_time
                ? dateFormatter.format(new Date(meta.mod_time * 1000))
                : null
            const buttonSet = new Set(subscription.buttons ?? [])
            const showQR = buttonSet.has('qr')
            const showCopy = buttonSet.has('copy')
            const showImport = buttonSet.has('import')

            return (
              <Card key={subscription.id} className='flex min-w-[320px] flex-col justify-between'>
                <CardHeader>
                  <div className='flex items-start gap-3'>
                    <div className='flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary'>
                      <Icon className='size-6' />
                    </div>
                    <div className='space-y-1 text-left'>
                      <CardTitle className='text-lg'>{subscription.name}</CardTitle>
                      <CardDescription>{subscription.description || '—'}</CardDescription>
                      {meta ? (
                        <p className='text-xs text-muted-foreground'>
                          最新版本：{meta.latest_version > 0 ? `v${meta.latest_version}` : `暂无历史`}
                          {updatedLabel ? ` · 更新时间：${updatedLabel}` : ``}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className='space-y-4'>
                  <div className='break-all rounded-lg border bg-muted/40 p-3 font-mono text-xs shadow-inner sm:text-sm'>
                    {subscribeURL}
                  </div>
                  <div className='flex items-center justify-between gap-3'>
                    {showQR ? (
                      <Button
                        size='sm'
                        variant='outline'
                        className='px-2'
                        title='显示二维码'
                        onClick={() => setQrValue(subscribeURL)}
                      >
                        <QrCode className='size-4' />
                      </Button>
                    ) : (
                      <div className='w-10' />
                    )}
                    <div className='flex flex-1 items-center justify-end gap-2'>
                      {showCopy ? (
                        <Button
                          size='sm'
                          className='transition-transform hover:-translate-y-0.5 hover:shadow-md active:translate-y-0.5 active:scale-95'
                          onClick={() => handleCopy(subscribeURL)}
                        >
                          <Copy className='mr-2 size-4' />复制
                        </Button>
                      ) : null}
                      {showImport ? (
                        <Button
                          size='sm'
                          variant='secondary'
                          className='transition-transform hover:-translate-y-0.5 hover:shadow-md active:translate-y-0.5 active:scale-95'
                          asChild
                        >
                          <a href={clashURL}>
                            <Download className='mr-2 size-4' />导入 Clash
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </section>
      </main>

      <Dialog
        open={Boolean(qrValue)}
        onOpenChange={(open) => {
          if (!open) {
            setQrValue(null)
          }
        }}
      >
        <DialogContent className='sm:max-w-sm'>
          <DialogHeader>
            <DialogTitle>订阅二维码</DialogTitle>
            <DialogDescription>使用手机扫描二维码快速导入订阅链接。</DialogDescription>
          </DialogHeader>
          {qrValue ? (
            <div className='flex flex-col items-center gap-4'>
              <div className='rounded-xl border bg-white p-4 shadow-inner'>
                <QRCodeCanvas value={qrValue} size={220} level='M' includeMargin />
              </div>
              <div className='font-mono text-xs break-all text-center text-muted-foreground'>
                {qrValue}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
