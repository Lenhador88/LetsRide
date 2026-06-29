'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bike, Users, MapPin, UserCheck, LayoutDashboard } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { href: '/rides', label: 'Rides', icon: MapPin },
  { href: '/clubs', label: 'Clubs', icon: Bike },
  { href: '/friends', label: 'Friends', icon: UserCheck },
]

export function Navbar() {
  const pathname = usePathname()

  return (
    <>
      {/* Top bar */}
      <header className="fixed top-0 left-0 right-0 z-50 flex h-14 items-center border-b border-zinc-800 bg-zinc-950 px-4">
        <Link href="/dashboard" className="flex items-center gap-2 font-bold text-orange-500">
          <Bike className="h-5 w-5" />
          <span>LetsRide</span>
        </Link>
        <div className="ml-auto">
          <Link href="/profile" className="flex items-center gap-1 text-sm text-zinc-400 hover:text-white">
            <Users className="h-4 w-4" />
            Profile
          </Link>
        </div>
      </header>

      {/* Bottom tab bar (mobile-first) */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-zinc-800 bg-zinc-950 pb-safe">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-1 flex-col items-center gap-1 py-3 text-xs transition-colors',
                active ? 'text-orange-500' : 'text-zinc-500 hover:text-zinc-300'
              )}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          )
        })}
      </nav>
    </>
  )
}
