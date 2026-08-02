import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { MapPin, Plus, Calendar, Users } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { formatDateTime } from '@/lib/utils'
import type { Ride } from '@/types'
import { PUBLIC_PROFILE_COLUMNS } from '@/lib/data/columns'

export default async function RidesPage() {
  const supabase = await createClient()

  const { data: rides } = await supabase
    .from('rides')
    .select(`
      *,
      organizer:profiles!organizer_id(${PUBLIC_PROFILE_COLUMNS}),
      members_count:ride_members(count)
    `)
    .eq('is_public', true)
    .gte('departure_at', new Date().toISOString())
    .order('departure_at', { ascending: true })

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Rides</h1>
        <Link href="/rides/new" className="inline-flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600 transition-colors">
          <Plus className="h-4 w-4" /> New Ride
        </Link>
      </div>

      {rides?.length === 0 && (
        <div className="py-16 text-center">
          <MapPin className="mx-auto mb-3 h-10 w-10 text-zinc-700" />
          <p className="text-zinc-400">No upcoming rides. Be the first to create one!</p>
          <Link href="/rides/new" className="mt-4 inline-flex items-center rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors">
            Create a Ride
          </Link>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {rides?.map((ride) => (
          <Link key={ride.id} href={`/rides/${ride.id}`}>
            <Card className="hover:border-zinc-600 transition-colors">
              <div className="flex items-start gap-3">
                <Avatar
                  src={ride.organizer?.avatar_url}
                  name={ride.organizer?.username ?? 'Rider'}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-white">{ride.title}</p>
                  {ride.description && (
                    <p className="mt-0.5 text-sm text-zinc-400 line-clamp-1">{ride.description}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-500">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatDateTime(ride.departure_at)}
                    </span>
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {ride.meeting_point}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {(ride as Ride & { members_count: [{ count: number }] }).members_count?.[0]?.count ?? 0} going
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
