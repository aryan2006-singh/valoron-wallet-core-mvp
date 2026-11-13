import { AssistantChat } from '@/components/assistant/assistant-chat'

export const metadata = { title: 'Assistant · Valoron' }

export default function AssistantPage() {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <AssistantChat />
    </div>
  )
}
