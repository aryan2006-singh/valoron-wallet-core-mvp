'use client'

import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { askAssistant } from '@/app/(app)/assistant/actions'
import type { ChatTurn } from '@/lib/ai/assistant'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const SUGGESTIONS = [
  'How much did I spend this week?',
  'What was my biggest transfer last month?',
  'Which category do I spend the most on?',
  'Show my last 5 deposits',
]

// The server only accepts the last 20 turns; older ones are dropped here.
const MAX_TURNS = 20

export function AssistantChat() {
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns, pending])

  async function send(text: string) {
    const question = text.trim()
    if (!question || pending) return
    const next: ChatTurn[] = [...turns, { role: 'user' as const, content: question }].slice(-MAX_TURNS)
    // A history must start with a user turn.
    while (next.length > 0 && next[0].role !== 'user') next.shift()
    setTurns(next)
    setDraft('')
    setError(null)
    setPending(true)
    const result = await askAssistant(next)
    setPending(false)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setTurns([...next, { role: 'assistant', content: result.reply }])
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4" aria-hidden />
          Wallet assistant
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Ask about your balance, transfers and spending. It can read your wallet but can&apos;t move money.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-h-[55vh] min-h-48 space-y-3 overflow-y-auto" aria-live="polite">
          {turns.length === 0 && (
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <Button key={s} variant="outline" size="sm" onClick={() => send(s)}>
                  {s}
                </Button>
              ))}
            </div>
          )}
          {turns.map((t, i) => (
            <div
              key={i}
              className={cn(
                'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
                t.role === 'user' ? 'ml-auto bg-primary text-primary-foreground' : 'bg-muted'
              )}
            >
              {t.content}
            </div>
          ))}
          {pending && <div className="w-fit rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">Thinking…</div>}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div ref={bottomRef} />
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            send(draft)
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask about your wallet…"
            aria-label="Message"
            maxLength={2000}
            disabled={pending}
          />
          <Button type="submit" disabled={pending || !draft.trim()}>
            Ask
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
