import { createClient } from '@/lib/supabase/server'
import { UserCheck, UserPlus, Search } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { FriendActions } from '@/components/friends/FriendActions'
import { SearchRiders } from '@/components/friends/SearchRiders'

export default async function FriendsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: friends }, { data: pendingReceived }] = await Promise.all([
    supabase
      .from('friendships')
      .select('*, requester:profiles!requester_id(*), addressee:profiles!addressee_id(*)')
      .or(`requester_id.eq.${user!.id},addressee_id.eq.${user!.id}`)
      .eq('status', 'accepted'),
    supabase
      .from('friendships')
      .select('*, requester:profiles!requester_id(*)')
      .eq('addressee_id', user!.id)
      .eq('status', 'pending'),
  ])

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <h1 className="mb-6 text-xl font-bold text-white">Friends</h1>

      <SearchRiders currentUserId={user!.id} />

      {pendingReceived && pendingReceived.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 font-semibold text-white flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-orange-500" />
            Requests ({pendingReceived.length})
          </h2>
          <div className="flex flex-col gap-2">
            {pendingReceived.map((req) => (
              <Card key={req.id}>
                <div className="flex items-center gap-3">
                  <Avatar
                    src={req.requester?.avatar_url}
                    name={req.requester?.full_name || req.requester?.username || 'Rider'}
                    size="md"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-white">{req.requester?.full_name || req.requester?.username}</p>
                    <p className="text-xs text-zinc-500">@{req.requester?.username}</p>
                  </div>
                  <FriendActions friendshipId={req.id} action="accept" />
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="mb-3 font-semibold text-white flex items-center gap-2">
          <UserCheck className="h-4 w-4 text-orange-500" />
          My Friends ({friends?.length ?? 0})
        </h2>
        {friends?.length === 0 ? (
          <div className="py-10 text-center">
            <Search className="mx-auto mb-3 h-10 w-10 text-zinc-700" />
            <p className="text-zinc-400 text-sm">No friends yet. Search for riders above.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {friends?.map((f) => {
              const friend = f.requester_id === user!.id ? f.addressee : f.requester
              return (
                <Card key={f.id}>
                  <div className="flex items-center gap-3">
                    <Avatar
                      src={friend?.avatar_url}
                      name={friend?.full_name || friend?.username || 'Rider'}
                      size="md"
                    />
                    <div className="flex-1">
                      <p className="font-medium text-white">{friend?.full_name || friend?.username}</p>
                      <p className="text-xs text-zinc-500">@{friend?.username}</p>
                      {friend?.bike_model && (
                        <p className="text-xs text-orange-400">{friend.bike_model}</p>
                      )}
                    </div>
                    <FriendActions friendshipId={f.id} action="remove" />
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
