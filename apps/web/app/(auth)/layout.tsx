import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

/**
 * Chrome for the signed-out auth screens: the 3D stage shows through, and
 * the form sits on a single dark glass panel. The signed-in shell lives in
 * app/(app)/layout.tsx; separate route groups are why login has no wallet
 * navigation on it.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col px-6 py-6">
      <header className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-lg font-medium tracking-tight">
          <span className="grid size-5 place-items-center rounded-[5px] bg-primary text-[0.7rem] font-semibold text-primary-foreground">
            v
          </span>
          valoron
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-mono text-xs tracking-widest text-muted-foreground uppercase transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Home
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center py-10 lg:justify-start lg:pl-[8vw]">
        <div className="w-full max-w-sm rounded-2xl border bg-black/60 p-8 backdrop-blur-md">{children}</div>
      </main>
      <p className="text-center font-mono text-[0.7rem] tracking-widest text-muted-foreground uppercase lg:text-left">
        Payments by Stripe · Balances in USD
      </p>
    </div>
  )
}
