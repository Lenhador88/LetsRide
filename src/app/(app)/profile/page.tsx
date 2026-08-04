import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Bike } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Card } from '@/components/ui/Card'
import { SignOutButton } from '@/components/profile/SignOutButton'
import { EditProfileForm } from '@/components/profile/EditProfileForm'

export default async function ProfilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()

  const [{ count: rideCount }, { count: clubCount }] = await Promise.all([
    supabase.from('ride_members').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
    supabase.from('club_members').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
  ])

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Profile</h1>
        <SignOutButton />
      </div>

      <div className="mb-6 flex flex-col items-center gap-3">
        <Avatar
          src={profile?.avatar_url}
          name={profile?.username ?? 'Rider'}
          size="xl"
        />
        <div className="text-center">
          <p className="text-xl font-bold text-white">{profile?.username ?? 'Rider'}</p>
          <p className="text-sm text-zinc-500">@{profile?.username}</p>
          {profile?.bike_model && (
            <p className="mt-1 text-sm text-orange-400 flex items-center justify-center gap-1">
              <Bike className="h-3 w-3" /> {profile.bike_model}
            </p>
          )}
        </div>
      </div>

      {/* Two stats since 013 dropped friendships. Deliberately not backfilled
          with a third (postcards, say) — the design's Profile section is 25
          unread frames, and inventing a stat to fill a grid column is the kind
          of guess that outlives the reason for it. */}
      <div className="mb-6 grid grid-cols-2 gap-3">
        {[
          { label: 'Rides', value: rideCount ?? 0 },
          { label: 'Clubs', value: clubCount ?? 0 },
        ].map(({ label, value }) => (
          <Card key={label} className="text-center">
            <p className="text-2xl font-bold text-white">{value}</p>
            <p className="text-xs text-zinc-500">{label}</p>
          </Card>
        ))}
      </div>

      <EditProfileForm profile={profile} />
    </div>
  )
}
