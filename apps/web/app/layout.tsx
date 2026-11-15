import type { Metadata } from "next";
import { AutoRevealMount } from "@/components/marketing/auto-reveal-mount";
import { Geist_Mono, Inter_Tight } from "next/font/google";
import "./globals.css";
import { StageCanvas } from "@/components/stage/stage-canvas";
import { Toaster } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/server";
import { formatCents } from "@/lib/format";

// The logged-in user's own balance (RLS-scoped session, no service role),
// painted onto the 3D cards. Null when logged out or on any failure.
async function getBalanceLabel(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: account } = await supabase.from("accounts").select("id").eq("user_id", user.id).single();
    if (!account) return null;
    const { data: latest } = await supabase
      .from("ledger_entries")
      .select("balance_after_cents")
      .eq("account_id", account.id)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    return formatCents(latest?.balance_after_cents ?? 0);
  } catch {
    return null;
  }
}

const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Valoron Wallet",
  description: "Send, hold and move money on a ledger that proves itself.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const balance = await getBalanceLabel();
  return (
    <html
      lang="en"
      className={`dark ${interTight.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <StageCanvas balance={balance} />
        {children}
        <AutoRevealMount />
        <Toaster />
      </body>
    </html>
  );
}
