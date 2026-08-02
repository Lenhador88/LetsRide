import { cn } from '@/lib/utils'
import { HTMLAttributes } from 'react'

/**
 * `v2 / Component / App Background` — the 135deg linear gradient every screen
 * in the app uses except the splash, which is flat `Accent Brand/100`
 * (`#3D996B`) and should not use this component. The gradient itself lives in
 * `globals.css` as the `bg-app-gradient` utility, not inline here, so every
 * consumer stays wired to the same token.
 */
export function AppBackground({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('min-h-dvh w-full bg-app-gradient', className)} {...props}>
      {children}
    </div>
  )
}
