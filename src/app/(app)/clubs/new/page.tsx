'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

export default function NewClubPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', description: '', is_public: true })

  function setField(field: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/auth/login'); return }

    const { data, error } = await supabase
      .from('clubs')
      .insert({ name: form.name, description: form.description || null, is_public: form.is_public, owner_id: user.id })
      .select()
      .single()

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      await supabase.from('club_members').insert({ club_id: data.id, user_id: user.id, role: 'owner' })
      router.push(`/clubs/${data.id}`)
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/clubs" className="text-zinc-400 hover:text-white">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-bold text-white">Create a Club</h1>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Club Name *"
          placeholder="e.g. Pacific Coast Riders"
          value={form.name}
          onChange={(e) => setField('name', e.target.value)}
          required
        />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-zinc-300">Description</label>
          <textarea
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
            placeholder="What's your club about?"
            rows={3}
            value={form.description}
            onChange={(e) => setField('description', e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="is_public"
            checked={form.is_public}
            onChange={(e) => setField('is_public', e.target.checked)}
            className="h-4 w-4 rounded border-zinc-700 accent-orange-500"
          />
          <label htmlFor="is_public" className="text-sm text-zinc-300">
            Public club — anyone can find and join
          </label>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <Button type="submit" loading={loading} size="lg" className="mt-2">
          Create Club
        </Button>
      </form>
    </div>
  )
}
