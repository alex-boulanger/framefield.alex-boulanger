import { createFileRoute } from '@tanstack/react-router'
import { Lab } from '#/ui/Lab'

// The first screen is the tool, not a landing page.
export const Route = createFileRoute('/')({ component: Lab })
