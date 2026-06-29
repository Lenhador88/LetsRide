'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'

interface Props {
  friendshipId: string
  action: 'accept' | 'remove'
}

export function FriendActions({ friendshipId, action }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleAccept() {
    setLoading(true)
    const supabase = createClient()
    await supabase.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId)
    setLoading(false)
    router.refresh()
  }

  async function handleRemove() {
    setLoading(true)
    const supabase = createClient()
    await supabase.from('friendships').delete().eq('id', friendshipId)
    setLoading(false)
    router.refresh()
  }

  if (action === 'accept') {
    return (
      <div className="flex gap-2">
        <Button size="sm" onClick={handleAccept} loading={loading}>Accept</Button>
        <Button size="sm" variant="secondary" onClick={handleRemove} loading={loading}>Decline</Button>
      </div>
    )
  }

  return (
    <Button size="sm" variant="ghost" onClick={handleRemove} loading={loading}>
      Remove
    </Button>
  )
}
