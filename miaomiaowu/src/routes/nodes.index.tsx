import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/nodes/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/nodes/"!</div>
}
