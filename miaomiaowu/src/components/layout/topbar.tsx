import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Activity, Link as LinkIcon, Radar, Users, Database } from 'lucide-react'
import { ThemeSwitch } from '@/components/theme-switch'
import { UserMenu } from './user-menu'
import { useAuthStore } from '@/stores/auth-store'
import { profileQueryFn } from '@/lib/profile'

const baseNavLinks = [
  {
    title: '流量信息',
    to: '/',
    icon: Activity,
  },
  {
    title: '订阅链接',
    to: '/subscription',
    icon: LinkIcon,
  },
  // {
  //   title: '节点管理',
  //   to: '/nodes',
  //   icon: Network,
  // },
]

const adminNavLinks = [
  {
    title: '探针管理',
    to: '/probe',
    icon: Radar,
  },
  {
    title: '订阅管理',
    to: '/subscribe-files',
    icon: Database,
  },
  // {
  //   title: '规则配置',
  //   to: '/rules',
  //   icon: Settings2,
  // },
  {
    title: '用户管理',
    to: '/users',
    icon: Users,
  },
]

export function Topbar() {
  const { auth } = useAuthStore()
  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: profileQueryFn,
    enabled: Boolean(auth.accessToken),
    staleTime: 5 * 60 * 1000,
  })

  const navLinks = profile?.is_admin ? [...baseNavLinks, ...adminNavLinks] : baseNavLinks

  return (
    <header className='border-b bg-background'>
      <div className='flex h-14 items-center justify-between px-4 sm:px-6'>
        <div className='flex items-center gap-4 sm:gap-6'>
          <Link
            to='/'
            className='font-semibold text-lg tracking-tight flex items-center gap-2'
          >
            <img
              src='/images/logo.webp'
              alt='妙妙屋 Logo'
              className='h-8 w-8 rounded-full'
            />
            <span className='hidden sm:inline'>妙妙屋</span>
          </Link>

          <nav className='flex items-center gap-2 sm:gap-3'>
            {navLinks.map(({ title, to, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                aria-label={title}
                className='flex items-center gap-2 rounded-full px-2 py-1 text-sm font-medium text-muted-foreground transition hover:text-primary sm:px-3'
              >
                <Icon className='size-5' />
                <span className='hidden sm:inline'>{title}</span>
              </Link>
            ))}
          </nav>
        </div>

        <div className='flex items-center gap-2'>
          <ThemeSwitch />
          <UserMenu />
        </div>
      </div>
    </header>
  )
}
