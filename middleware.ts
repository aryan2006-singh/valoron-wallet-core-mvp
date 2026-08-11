import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/signup']

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // TEMP DIAGNOSTIC — remove once the post-login navigation issue is confirmed fixed.
  console.log('[mw-debug]', request.method, request.nextUrl.pathname, 'user=', user?.id ?? 'none')

  // "/" has no page content of its own — it only ever routes to the
  // signed-in dashboard or the signed-out login screen.
  if (request.nextUrl.pathname === '/') {
    console.log('[mw-debug] rule=root-redirect target=', user ? '/dashboard' : '/login')
    return NextResponse.redirect(new URL(user ? '/dashboard' : '/login', request.url))
  }

  const isPublic =
    PUBLIC_PATHS.includes(request.nextUrl.pathname) ||
    request.nextUrl.pathname.startsWith('/api/webhooks')

  if (!user && !isPublic) {
    console.log('[mw-debug] rule=no-user-not-public -> redirect /login')
    return NextResponse.redirect(new URL('/login', request.url))
  }

  console.log('[mw-debug] rule=allow')
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
