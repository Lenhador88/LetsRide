import { Button } from '@/components/ui/Button'
import { CreatePostcardForm } from '@/components/postcards/CreatePostcardForm'
import { getMyClubs } from '@/lib/data/clubs'

export default async function NewPostcardPage() {
  const clubs = await getMyClubs()

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-2">
        <Button href="/postcards" variant="link">
          Back
        </Button>
        <h1 className="text-2xl font-semibold text-foreground">New postcard</h1>
      </div>

      <CreatePostcardForm clubs={clubs} />
    </div>
  )
}
