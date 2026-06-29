import Link from 'next/link'
import { Bike, MapPin, Users, Shield } from 'lucide-react'
import { Button } from '@/components/ui/Button'

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col bg-zinc-950">
      {/* Hero */}
      <section className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-500">
          <Bike className="h-8 w-8 text-white" />
        </div>
        <h1 className="mb-4 text-4xl font-bold tracking-tight text-white sm:text-5xl">
          Ride Together,<br />
          <span className="text-orange-500">Anywhere</span>
        </h1>
        <p className="mb-8 max-w-md text-lg text-zinc-400">
          Plan rides, join motorcycle clubs, and stay connected with your crew. Built for riders, by riders.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button size="lg">
            <Link href="/auth/signup">Get Started &mdash; It&apos;s Free</Link>
          </Button>
          <Button size="lg" variant="secondary">
            <Link href="/auth/login">Sign In</Link>
          </Button>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-zinc-800 px-6 py-16">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-10 text-center text-2xl font-bold text-white">Everything for your rides</h2>
          <div className="grid gap-6 sm:grid-cols-3">
            {[
              {
                icon: MapPin,
                title: 'Plan Rides',
                desc: 'Create rides with meeting points, departure times, and routes. Invite friends or make it public.',
              },
              {
                icon: Users,
                title: 'Join Clubs',
                desc: 'Discover public motorcycle clubs or create your own. Stay updated on club rides and news.',
              },
              {
                icon: Shield,
                title: 'Ride with Trust',
                desc: "Connect with verified riders, manage your crew, and know who's coming before you roll out.",
              },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10">
                  <Icon className="h-5 w-5 text-orange-500" />
                </div>
                <h3 className="mb-2 font-semibold text-white">{title}</h3>
                <p className="text-sm text-zinc-400">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
