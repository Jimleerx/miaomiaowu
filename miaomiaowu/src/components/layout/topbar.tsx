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
    <header className='border-b border-[color:rgba(241,140,110,0.22)] bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60'>
      <div className='flex h-16 items-center justify-between px-4 sm:px-6'>
        <div className='flex items-center gap-4 sm:gap-6'>
          <Link
            to='/'
            className='flex items-center gap-3 font-semibold text-lg tracking-tight transition hover:text-primary outline-none focus:outline-none'
          >
            <img
              src='/images/logo.webp'
              alt='妙妙屋 Logo'
              className='h-10 w-10 border-2 border-[color:rgba(241,140,110,0.4)] shadow-[4px_4px_0_rgba(0,0,0,0.2)]'
            />
            <span className='hidden sm:inline pixel-text text-primary text-base'>妙妙屋</span>
          </Link>

          <nav className='flex items-center gap-2 sm:gap-3'>
            {navLinks.map(({ title, to, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                aria-label={title}
                className='pixel-button inline-flex items-center justify-start gap-3 min-w-[90px] px-3 py-2 h-9 text-sm font-semibold uppercase tracking-widest bg-background/75 text-foreground border-[color:rgba(137,110,96,0.45)] hover:bg-accent/35 hover:text-accent-foreground dark:bg-input/30 dark:border-[color:rgba(255,255,255,0.18)] dark:hover:bg-accent/45 dark:hover:text-accent-foreground transition-all'
                activeProps={{
                  className: 'bg-primary/20 text-primary border-[color:rgba(217,119,87,0.55)] dark:bg-primary/20 dark:border-[color:rgba(217,119,87,0.55)]'
                }}
              >
                <Icon className='size-[18px] shrink-0' />
                <span className='hidden sm:inline'>{title}</span>
              </Link>
            ))}
          </nav>
        </div>

        <div className='flex items-center gap-3'>
          <ThemeSwitch />
          <UserMenu />
        </div>
      </div>
    </header>
  )
}
