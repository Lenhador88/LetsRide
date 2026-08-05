import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { ArrowLeft, MapPin, Users } from 'lucide-react'
import Link from 'next/link'
import { Avatar } from '@/components/ui/Avatar'
import { Card } from '@/components/ui/Card'
import { formatRideDate, formatRideTime } from '@/lib/utils'
import { JoinClubButton } from '@/components/clubs/JoinClubButton'
import type { ClubMember, Ride } from '@/types'
import { PUBLIC_PROFILE_COLUMNS } from '@/lib/data/columns'
import { resolveAvatarUrls } from '@/lib/data/media'

export default async function ClubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: club }, { data: members }, { data: rides }] = await Promise.all([
    supabase.from('clubs').select(`*, owner:profiles!owner_id(${PUBLIC_PROFILE_COLUMNS})`).eq('id', id).single(),
    supabase.from('club_members').select(`*, profile:profiles(${PUBLIC_PROFILE_COLUMNS})`).eq('club_id', id),
    supabase
      .from('rides')
      .select('*')
      .eq('club_id', id)
      .gte('departure_at', new Date().toISOString())
      .order('departure_at', { ascending: true })
      .limit(5),
  ])

  // This page queries Supabase directly — it is v1 and predates lib/data/. That
  // is why the avatar signing has to be repeated by hand here instead of being
  // inherited: the seven call sites in lib/data/ cover every read that goes
  // through the data layer, and this one does not. It is the strongest argument
  // in the repo for finishing the clubs migration.
  await resolveAvatarUrls(
    [
      (club as { owner?: { avatar_url?: string | null; avatar_path?: string | null } } | null)?.owner,
      ...((members ?? []) as { profile?: { avatar_url?: string | null; avatar_path?: string | null } }[])
        .map((member) => member.profile),
    ],
    supabase
  )

  if (!club) notFound()

  const myMembership = members?.find((m) => m.user_id === user?.id)
  const isOwner = club.owner_id === user?.id

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/clubs" className="text-zinc-400 hover:text-white">
          <ArrowLeft className="h-5 w-5" />
        </Link>
      </div>

      <div className="mb-6 flex items-center gap-4">
        <Avatar src={club.avatar_url} name={club.name} size="xl" />
        <div>
          <h1 className="text-2xl font-bold text-white">{club.name}</h1>
          <p className="text-sm text-zinc-400 flex items-center gap-1 mt-0.5">
            <Users className="h-3 w-3" />
            {members?.length ?? 0} members
          </p>
        </div>
      </div>

      {club.description && (
        <Card className="mb-4">
          <p className="text-sm text-zinc-300">{club.description}</p>
        </Card>
      )}

      {!isOwner && user && (
        <JoinClubButton clubId={club.id} isMember={!!myMembership} />
      )}

      {rides && rides.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 font-semibold text-white flex items-center gap-2">
            <MapPin className="h-4 w-4 text-orange-500" />
            Upcoming Club Rides
          </h2>
          <div className="flex flex-col gap-2">
            {rides.map((ride) => (
              <Link key={ride.id} href={`/rides/${ride.id}`}>
                <Card className="hover:border-zinc-600 transition-colors">
                  <p className="font-medium text-white">{(ride as Ride).title}</p>
                  {/* The ride helpers, not a generic date formatter: this is the
                      same instant `/rides` and `/rides/[id]` draw, and before
                      this the three screens disagreed by two hours. */}
                  <p className="mt-1 text-xs text-orange-400">
                    {formatRideDate((ride as Ride).departure_at)} ·{' '}
                    {formatRideTime((ride as Ride).departure_at)}
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5 flex items-center gap-1">
                    <MapPin className="h-3 w-3" />{(ride as Ride).meeting_point}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="mb-3 font-semibold text-white flex items-center gap-2">
          <Users className="h-4 w-4 text-orange-500" />
          Members
        </h2>
        <div className="flex flex-col gap-2">
          {members?.map((member) => (
            <div key={member.user_id} className="flex items-center gap-3">
              <Avatar
                src={(member as ClubMember).profile?.avatar_url}
                name={(member as ClubMember).profile?.username ?? 'Rider'}
                size="sm"
              />
              <div className="flex-1">
                <p className="text-sm font-medium text-white">
                  {(member as ClubMember).profile?.username ?? 'Rider'}
                </p>
              </div>
              {member.role !== 'member' && (
                <span className="rounded-full bg-orange-500/10 px-2 py-0.5 text-xs capitalize text-orange-500">
                  {member.role}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
