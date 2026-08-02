'use client'

import { useState } from 'react'
import { Search, UserPlus, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import type { Profile } from '@/types'

export function SearchRiders({ currentUserId }: { currentUserId: string }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Profile[]>([])
  const [sent, setSent] = useState<Set<string>>(new Set())
  const [searching, setSearching] = useState(false)

  async function search(q: string) {
    setQuery(q)
    if (q.trim().length < 2) { setResults([]); return }
    setSearching(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .neq('id', currentUserId)
      // .ilike() rather than .or(): the .or() form interpolates the raw query
      // into a PostgREST filter string, where a comma or paren injects extra
      // filters. Passing the pattern as a value closes that off.
      .ilike('username', `%${q}%`)
      .limit(10)
    setResults(data || [])
    setSearching(false)
  }

  async function sendRequest(userId: string) {
    const supabase = createClient()
    await supabase.from('friendships').insert({ requester_id: currentUserId, addressee_id: userId })
    setSent((prev) => new Set([...prev, userId]))
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <input
          type="text"
          placeholder="Search riders by username..."
          value={query}
          onChange={(e) => search(e.target.value)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-2 pl-9 pr-3 text-sm text-white placeholder-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
        />
      </div>

      {results.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          {results.map((rider) => (
            <Card key={rider.id}>
              <div className="flex items-center gap-3">
                <Avatar src={rider.avatar_url} name={rider.username ?? 'Rider'} size="md" />
                <div className="flex-1">
                  <p className="font-medium text-white">{rider.username ?? 'Rider'}</p>
                  <p className="text-xs text-zinc-500">@{rider.username}</p>
                  {rider.bike_model && <p className="text-xs text-orange-400">{rider.bike_model}</p>}
                </div>
                <Button
                  size="sm"
                  variant={sent.has(rider.id) ? 'secondary' : 'primary'}
                  onClick={() => !sent.has(rider.id) && sendRequest(rider.id)}
                >
                  {sent.has(rider.id) ? (
                    <><Check className="h-3 w-3" /> Sent</>
                  ) : (
                    <><UserPlus className="h-3 w-3" /> Add</>
                  )}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {searching && <p className="mt-2 text-sm text-zinc-500">Searching...</p>}
    </div>
  )
}
