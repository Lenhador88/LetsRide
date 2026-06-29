import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { MapPin, Calendar, Users, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { Avatar } from '@/components/ui/Avatar'
import { Card } from '@/components/ui/Card'
import { formatDateTime } from '@/lib/utils'
import { JoinRideButton } from '@/components/rides/JoinRideButton'
import type { Ride, RideMember } from '@/types'

export default async function RidePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: ride }, { data: members }] = await Promise.all([
    supabase
      .from('rides')
      .select('*, organizer:profiles!organizer_id(*)')
      .eq('id', id)
      .single(),
    supabase
      .from('ride_members')
      .select('*, profile:profiles(*)')
      .eq('ride_id', id),
  ])

  if (!ride) notFound()

  const isMember = members?.some((m) => m.user_id === user?.id)
  const isOrganizer = ride.organizer_id === user?.id

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/rides" className="text-zinc-400 hover:text-white">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-bold text-white line-clamp-1">{ride.title}</h1>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <Avatar
          src={(ride as Ride).organizer?.avatar_url}
          name={(ride as Ride).organizer?.full_name || (ride as Ride).organizer?.username || 'Rider'}
          size="md"
        />
        <div>
          <p className="text-xs text-zinc-500">Organized by</p>
          <p className="font-medium text-white">
            {(ride as Ride).organizer?.full_name || (ride as Ride).organizer?.username}
          </p>
        </div>
      </div>

      <Card className="mb-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
            <div>
              <p className="text-xs text-zinc-500">Departure</p>
              <p className="text-sm text-white">{formatDateTime(ride.departure_at)}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
            <div>
              <p className="text-xs text-zinc-500">Meeting Point</p>
              <p className="text-sm text-white">{ride.meeting_point}</p>
            </div>
          </div>
          {ride.max_riders && (
            <div className="flex items-start gap-3">
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
              <div>
                <p className="text-xs text-zinc-500">Capacity</p>
                <p className="text-sm text-white">{members?.length ?? 0} / {ride.max_riders} riders</p>
              </div>
            </div>
          )}
        </div>
      </Card>

      {ride.description && (
        <Card className="mb-4">
          <p className="text-xs text-zinc-500 mb-1">About this ride</p>
          <p className="text-sm text-zinc-300">{ride.description}</p>
        </Card>
      )}

      {ride.route_description && (
        <Card className="mb-4">
          <p className="text-xs text-zinc-500 mb-1">Route</p>
          <p className="text-sm text-zinc-300">{ride.route_description}</p>
        </Card>
      )}

      {!isOrganizer && user && (
        <JoinRideButton rideId={ride.id} isMember={!!isMember} />
      )}

      <section className="mt-6">
        <h2 className="mb-3 font-semibold text-white flex items-center gap-2">
          <Users className="h-4 w-4 text-orange-500" />
          Riders ({members?.length ?? 0})
        </h2>
        <div className="flex flex-col gap-2">
          {members?.map((member) => (
            <div key={member.user_id} className="flex items-center gap-3">
              <Avatar
                src={(member as RideMember).profile?.avatar_url}
                name={(member as RideMember).profile?.full_name || (member as RideMember).profile?.username || 'Rider'}
                size="sm"
              />
              <div>
                <p className="text-sm font-medium text-white">
                  {(member as RideMember).profile?.full_name || (member as RideMember).profile?.username}
                </p>
                <p className="text-xs text-zinc-500 capitalize">{member.status}</p>
              </div>
              {member.user_id === ride.organizer_id && (
                <span className="ml-auto rounded-full bg-orange-500/10 px-2 py-0.5 text-xs text-orange-500">
                  Organizer
                </span>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
