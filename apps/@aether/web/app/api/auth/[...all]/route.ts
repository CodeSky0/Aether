import { createNextAuthHandler } from '@aether/auth'
import { getAuth } from '@/lib/auth'

type AuthHandler = ReturnType<typeof createNextAuthHandler>

let authHandler: AuthHandler | null = null

function getHandler(): AuthHandler {
  if (authHandler === null) {
    authHandler = createNextAuthHandler(getAuth())
  }
  return authHandler
}

export async function GET(request: Request): Promise<Response> {
  return getHandler().GET(request)
}

export async function POST(request: Request): Promise<Response> {
  return getHandler().POST(request)
}

export async function PATCH(request: Request): Promise<Response> {
  return getHandler().PATCH(request)
}

export async function PUT(request: Request): Promise<Response> {
  return getHandler().PUT(request)
}

export async function DELETE(request: Request): Promise<Response> {
  return getHandler().DELETE(request)
}
