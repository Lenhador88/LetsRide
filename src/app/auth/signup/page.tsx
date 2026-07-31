'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bike } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

export default function SignupPage() {
  const router = useRouter()
  const [form, setForm] = useState({ email: '', password: '', username: '', full_name: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function setField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        data: { username: form.username, full_name: form.full_name },
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/dashboard')
      router.refresh()
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500">
            <Bike className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Join LetsRide</h1>
          <p className="text-sm text-zinc-400">Create your rider profile</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            id="full_name"
            label="Full Name"
            placeholder="John Rider"
            value={form.full_name}
            onChange={(e) => setField('full_name', e.target.value)}
            required
          />
          <Input
            id="username"
            label="Username"
            placeholder="johnrider"
            value={form.username}
            onChange={(e) => setField('username', e.target.value.toLowerCase().replace(/\s/g, ''))}
            required
          />
          <Input
            id="email"
            type="email"
            label="Email"
            placeholder="you@example.com"
            value={form.email}
            onChange={(e) => setField('email', e.target.value)}
            required
          />
          <Input
            id="password"
            type="password"
            label="Password"
            placeholder="Min. 8 characters"
            value={form.password}
            onChange={(e) => setField('password', e.target.value)}
            minLength={8}
            required
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" loading={loading} className="mt-1">
            Create Account
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-500">
          Already have an account?{' '}
          <Link href="/auth/login" className="text-orange-500 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
