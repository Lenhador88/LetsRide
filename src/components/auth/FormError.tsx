/**
 * One inline message above the primary button. Per §States, the field borders
 * deliberately stay neutral: the app cannot tell the rider which field was
 * wrong without revealing whether an account exists for that address.
 */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="text-sm font-medium text-danger">
      {message}
    </p>
  )
}
