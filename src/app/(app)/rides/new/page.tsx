'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

export default function NewRidePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    title: '',
    description: '',
    meeting_point: '',
    departure_at: '',
    route_description: '',
    max_riders: '',
    is_public: true,
  })

  function setField(field: string, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      router.push('/auth/login')
      return
    }

    const { data, error } = await supabase
      .from('rides')
      .insert({
        title: form.title,
        description: form.description || null,
        meeting_point: form.meeting_point,
        departure_at: new Date(form.departure_at).toISOString(),
        route_description: form.route_description || null,
        max_riders: form.max_riders ? parseInt(form.max_riders) : null,
        is_public: form.is_public,
        organizer_id: user.id,
      })
      .select()
      .single()

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      await supabase.from('ride_members').insert({ ride_id: data.id, user_id: user.id, status: 'going' })
      router.push(`/rides/${data.id}`)
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/rides" className="text-zinc-400 hover:text-white">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-bold text-white">Create a Ride</h1>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Ride Title *"
          placeholder="e.g. Sunday Morning Coastal Run"
          value={form.title}
          onChange={(e) => setField('title', e.target.value)}
          required
        />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-zinc-300">Description</label>
          <textarea
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
            placeholder="Tell riders what to expect..."
            rows={3}
            value={form.description}
            onChange={(e) => setField('description', e.target.value)}
          />
        </div>
        <Input
          label="Meeting Point *"
          placeholder="e.g. Shell Gas Station, Route 66"
          value={form.meeting_point}
          onChange={(e) => setField('meeting_point', e.target.value)}
          required
        />
        <Input
          type="datetime-local"
          label="Departure Date & Time *"
          value={form.departure_at}
          onChange={(e) => setField('departure_at', e.target.value)}
          required
        />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-zinc-300">Route Description</label>
          <textarea
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
            placeholder="Describe the route, stops, distance..."
            rows={2}
            value={form.route_description}
            onChange={(e) => setField('route_description', e.target.value)}
          />
        </div>
        <Input
          type="number"
          label="Max Riders (optional)"
          placeholder="Leave blank for unlimited"
          value={form.max_riders}
          onChange={(e) => setField('max_riders', e.target.value)}
          min={1}
        />
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="is_public"
            checked={form.is_public}
            onChange={(e) => setField('is_public', e.target.checked)}
            className="h-4 w-4 rounded border-zinc-700 accent-orange-500"
          />
          <label htmlFor="is_public" className="text-sm text-zinc-300">
            Public ride — anyone can see and join
          </label>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <Button type="submit" loading={loading} size="lg" className="mt-2">
          Create Ride
        </Button>
      </form>
    </div>
  )
}
