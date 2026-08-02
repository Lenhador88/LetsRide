import Link from 'next/link'

/**
 * The one deliberate exception to decision #1 (no anonymous access): a rider
 * has to be able to read these before completing signup. Static copy only —
 * these pages read no data, and /legal is allowlisted in proxy.ts.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background px-4 py-8">
      <div className="mx-auto flex max-w-[358px] flex-col gap-6">
        <Link href="/auth/signup" className="text-sm font-medium text-muted">
          Back
        </Link>
        <article className="flex flex-col gap-4 text-sm text-foreground">{children}</article>
      </div>
    </div>
  )
}
