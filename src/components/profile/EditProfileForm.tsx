'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import type { Profile } from '@/types'

export function EditProfileForm({ profile }: { profile: Profile | null }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState({
    full_name: profile?.full_name || '',
    bio: profile?.bio || '',
    bike_model: profile?.bike_model || '',
  })

  function setField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setSaved(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const supabase = createClient()
    await supabase
      .from('profiles')
      .update({ full_name: form.full_name || null, bio: form.bio || null, bike_model: form.bike_model || null })
      .eq('id', profile!.id)
    setLoading(false)
    setSaved(true)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h2 className="font-semibold text-white">Edit Profile</h2>
      <Input
        label="Full Name"
        placeholder="Your name"
        value={form.full_name}
        onChange={(e) => setField('full_name', e.target.value)}
      />
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-zinc-300">Bio</label>
        <textarea
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
          placeholder="Tell other riders about yourself..."
          rows={3}
          value={form.bio}
          onChange={(e) => setField('bio', e.target.value)}
        />
      </div>
      <Input
        label="Bike Model"
        placeholder="e.g. Honda CB500F"
        value={form.bike_model}
        onChange={(e) => setField('bike_model', e.target.value)}
      />
      <Button type="submit" loading={loading}>
        {saved ? 'Saved!' : 'Save Changes'}
      </Button>
    </form>
  )
}
