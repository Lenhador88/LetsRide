'use client'

import { Button } from '@/components/ui/Button'
import { CreatePostcardForm } from '@/components/postcards/CreatePostcardForm'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonForm } from '@/components/ui/Skeleton'
import { getMyClubs } from '@/lib/data/clubs'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'

export default function NewPostcardPage() {
  const clubs = useQuery(queryKeys.clubs.mine(), getMyClubs)

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-2">
        <Button href="/postcards" variant="link">
          Back
        </Button>
        <h1 className="text-2xl font-semibold text-foreground">New postcard</h1>
      </div>

      {/* The club picker is the only thing this screen reads, and a postcard
          with no club is the app-wide feed rather than an invalid one — so a
          rider could in principle compose while the list is still arriving. It
          still waits: rendering the form first would put the audience selector
          under a composer already in use, changing what Post does after the
          rider had decided what it did. */}
      {clubs.error ? (
        <ErrorState onRetry={clubs.refetch} />
      ) : !clubs.data ? (
        <SkeletonForm fields={2} />
      ) : (
        <div className="motion-safe:animate-fade-in">
          <CreatePostcardForm clubs={clubs.data} />
        </div>
      )}
    </div>
  )
}
