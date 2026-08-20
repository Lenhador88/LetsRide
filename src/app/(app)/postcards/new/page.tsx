'use client'

import { CreatePostcardForm } from '@/components/postcards/CreatePostcardForm'
import { Header } from '@/components/layout/Header'
import { ErrorState } from '@/components/ui/ErrorState'
import { SkeletonForm } from '@/components/ui/Skeleton'
import { getMyClubs } from '@/lib/data/clubs'
import { useQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query/keys'

export default function NewPostcardPage() {
  const clubs = useQuery(queryKeys.clubs.mine(), getMyClubs)

  return (
    <>
      <Header title="New postcard" backHref="/postcards" />

      <div className="px-4 pb-8">
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
    </>
  )
}
