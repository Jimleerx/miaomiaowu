import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Activity, Link as LinkIcon, Radar, Users, Database } from 'lucide-react'
import { ThemeSwitch } from '@/components/theme-switch'
import { UserMenu } from './user-menu'
import { useAuthStore } from '@/stores/auth-store'
import { profileQueryFn } from '@/lib/profile'
import { cn } from '@/lib/utils'

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
            className='flex items-center gap-3 font-semibold text-lg tracking-tight transition hover:text-primary'
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
                className={({ isActive }) =>
                  cn(
                    'pixel-pill h-12 min-w-[128px] justify-start gap-3 text-xs font-semibold uppercase tracking-[0.35em] text-muted-foreground transition-colors duration-200',
                    isActive && 'bg-primary/20 text-primary border-[color:rgba(217,119,87,0.55)]'
                  )
                }
              >
                <Icon className='size-[18px]' />
                <span className='hidden sm:inline tracking-[0.35em]'>{title}</span>
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
