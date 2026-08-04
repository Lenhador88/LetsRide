import Link from 'next/link'
import { Bike, Plus, Users } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { getClubs } from '@/lib/data/clubs'

// Still a v1 screen — `zinc-*`, `orange-500` and lucide icons — and it migrates
// to v2 with its own epic. What changed here is the read: it queried Supabase
// inline behind an `is_public` filter that hid private clubs from their own
// members. See getClubs().
export default async function ClubsPage() {
  const clubs = await getClubs()

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Clubs</h1>
        <Link href="/clubs/new" className="inline-flex items-center gap-1 rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600 transition-colors">
          <Plus className="h-4 w-4" /> New Club
        </Link>
      </div>

      {clubs.length === 0 && (
        <div className="py-16 text-center">
          <Bike className="mx-auto mb-3 h-10 w-10 text-zinc-700" />
          <p className="text-zinc-400">No clubs yet. Start one!</p>
          <Link href="/clubs/new" className="mt-4 inline-flex items-center rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors">
            Create a Club
          </Link>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {clubs.map((club) => (
          <Link key={club.id} href={`/clubs/${club.id}`}>
            <Card className="hover:border-zinc-600 transition-colors">
              <div className="flex items-center gap-3">
                <Avatar src={club.avatar_url} name={club.name} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-white">{club.name}</p>
                  {club.description && (
                    <p className="mt-0.5 text-sm text-zinc-400 line-clamp-1">{club.description}</p>
                  )}
                  <p className="mt-1 text-xs text-zinc-500 flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {club.members_count ?? 0} members
                  </p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
