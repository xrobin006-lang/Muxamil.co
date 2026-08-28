'use client'

import { useEffect } from 'react'
import { ShieldCheck } from 'lucide-react'
import { apiJson } from '@/lib/api-client'
import { useAppStore } from '@/stores/app-store'
import ChatWindow from '../components/chat-window'

/**
 * The signed-in user's private conversation with the admin team.
 * The conversation is lazy-created server-side on the first message, so the
 * window starts without an id and shows a friendly hello state until then.
 */
export default function ChatView() {
  const setUnreadMessages = useAppStore((s) => s.setUnreadMessages)

  // Entering the chat clears the unread badge — everything rendered is read.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await apiJson('/api/chat/read', 'POST', {})
      } catch {
        /* Silent — the badge re-syncs on the next session poll. */
      }
      if (!cancelled) setUnreadMessages(0)
    })()
    return () => {
      cancelled = true
    }
  }, [setUnreadMessages])

  return (
    <ChatWindow
      conversationId={null}
      peerId="admin"
      recipient={{
        name: 'Admin',
        subtitle: 'Official support',
        avatarIcon: ShieldCheck,
        isVerified: true,
        online: true,
      }}
      emptyTitle="Say hello to the admin team 👋"
      emptyDescription="This is your private conversation with the Muxamil.co admin team — ask questions, report issues or share feedback. You can also send photos, documents and voice messages with the mic button."
      className="h-[calc(100dvh-190px)] lg:h-[calc(100dvh-165px)]"
    />
  )
}
