'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'

export function JoinRideButton({ rideId, isMember }: { rideId: string; isMember: boolean }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [member, setMember] = useState(isMember)

  async function toggle() {
    setLoading(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    if (member) {
      await supabase.from('ride_members').delete().eq('ride_id', rideId).eq('user_id', user.id)
      setMember(false)
    } else {
      await supabase.from('ride_members').insert({ ride_id: rideId, user_id: user.id, status: 'going' })
      setMember(true)
    }

    setLoading(false)
    router.refresh()
  }

  return (
    <Button
      onClick={toggle}
      loading={loading}
      variant={member ? 'secondary' : 'primary'}
      size="lg"
      className="w-full"
    >
      {member ? "Can't Make It — Leave Ride" : "Join This Ride"}
    </Button>
  )
}
