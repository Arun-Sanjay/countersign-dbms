import { Compass } from 'lucide-react'
import { Link } from 'react-router'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'

export default function NotFoundPage() {
  return (
    <EmptyState
      icon={Compass}
      title="No page here"
      description="The link may be old, or the page may belong to another role."
      action={
        <Button asChild variant="outline">
          <Link to="/">Go home</Link>
        </Button>
      }
    />
  )
}
