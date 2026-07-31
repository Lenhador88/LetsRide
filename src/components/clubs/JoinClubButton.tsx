'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'

export function JoinClubButton({ clubId, isMember }: { clubId: string; isMember: boolean }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [member, setMember] = useState(isMember)

  async function toggle() {
    setLoading(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    if (member) {
      await supabase.from('club_members').delete().eq('club_id', clubId).eq('user_id', user.id)
      setMember(false)
    } else {
      await supabase.from('club_members').insert({ club_id: clubId, user_id: user.id, role: 'member' })
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
      className="w-full mb-4"
    >
      {member ? 'Leave Club' : 'Join Club'}
    </Button>
  )
}
