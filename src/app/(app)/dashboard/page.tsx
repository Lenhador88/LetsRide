import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { MapPin, Users, Plus, Calendar } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { formatDateTime } from '@/lib/utils'
import type { Ride } from '@/types'
import { PUBLIC_PROFILE_COLUMNS } from '@/lib/data/columns'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: profile }, { data: upcomingRides }, { data: myRides }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user!.id).single(),
    supabase
      .from('rides')
      .select(`*, organizer:profiles!organizer_id(${PUBLIC_PROFILE_COLUMNS})`)
      .eq('is_public', true)
      .gte('departure_at', new Date().toISOString())
      .order('departure_at', { ascending: true })
      .limit(5),
    supabase
      .from('ride_members')
      .select('ride:rides(*)')
      .eq('user_id', user!.id)
      .limit(3),
  ])

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      {/* Greeting */}
      <div className="mb-6 flex items-center gap-3">
        <Avatar src={profile?.avatar_url} name={profile?.username ?? 'Rider'} size="lg" />
        <div>
          <p className="text-sm text-zinc-400">Welcome back,</p>
          <h1 className="text-xl font-bold text-white">{profile?.username ?? 'Rider'}</h1>
        </div>
      </div>

      {/* Quick actions */}
      <div className="mb-6 grid grid-cols-2 gap-3">
        <Link href="/rides/new" className="inline-flex items-center justify-start gap-2 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors">
          <Plus className="h-4 w-4" /> New Ride
        </Link>
        <Link href="/clubs" className="inline-flex items-center justify-start gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 transition-colors">
          <Users className="h-4 w-4" /> Find Clubs
        </Link>
      </div>

      {/* Upcoming public rides */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-white flex items-center gap-2">
            <MapPin className="h-4 w-4 text-orange-500" /> Upcoming Rides
          </h2>
          <Link href="/rides" className="text-sm text-orange-500 hover:underline">See all</Link>
        </div>
        <div className="flex flex-col gap-3">
          {upcomingRides?.length === 0 && (
            <Card>
              <CardContent>No upcoming rides yet. <Link href="/rides/new" className="text-orange-500">Create one!</Link></CardContent>
            </Card>
          )}
          {upcomingRides?.map((ride) => (
            <RideCard key={ride.id} ride={ride as Ride} />
          ))}
        </div>
      </section>

      {/* My rides */}
      {myRides && myRides.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 font-semibold text-white flex items-center gap-2">
            <Calendar className="h-4 w-4 text-orange-500" /> My Upcoming Rides
          </h2>
          <div className="flex flex-col gap-3">
            {myRides.map(({ ride }) => {
              const r = ride as unknown as Ride
              return r && <RideCard key={r.id} ride={r} />
            })}
          </div>
        </section>
      )}
    </div>
  )
}

function RideCard({ ride }: { ride: Ride }) {
  return (
    <Link href={`/rides/${ride.id}`}>
      <Card className="hover:border-zinc-600 transition-colors">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-white truncate">{ride.title}</p>
            <p className="mt-0.5 text-xs text-zinc-500 flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {ride.meeting_point}
            </p>
            <p className="mt-1 text-xs text-orange-400">{formatDateTime(ride.departure_at)}</p>
          </div>
          <Avatar
            src={ride.organizer?.avatar_url}
            name={ride.organizer?.username ?? 'Rider'}
            size="sm"
          />
        </div>
      </Card>
    </Link>
  )
}
