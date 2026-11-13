import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// "/" is the public marketing page; /login and /signup are the auth
// screens. Everything else requires a session.
const PUBLIC_PATHS = ['/', '/login', '/signup']

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

  // Signed-in users have no reason to see the login/signup forms again —
  // send them to the wallet instead. "/" stays reachable either way so the
  // marketing page can be linked and shared without bouncing.
  if (user && (request.nextUrl.pathname === '/login' || request.nextUrl.pathname === '/signup')) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  const isPublic =
    PUBLIC_PATHS.includes(request.nextUrl.pathname) || request.nextUrl.pathname.startsWith('/api/webhooks') ||
    // Authenticated by its own bearer secret, not a user session.
    request.nextUrl.pathname.startsWith('/api/n8n/')

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
