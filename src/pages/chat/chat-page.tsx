import { useChat } from "@ai-sdk/react";
import { IconAlertCircle, IconFlag, IconMessages } from "@tabler/icons-react";
import { useRouter } from "@tanstack/react-router";
import { DefaultChatTransport } from "ai";
import { useEffect, useState } from "react";

import { PageHeader } from "@/shared/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import { Bubble, BubbleContent } from "@/shared/components/ui/bubble";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { Message, MessageContent } from "@/shared/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/shared/components/ui/message-scroller";
import { useChatBusy } from "@/shared/lib/chat-busy";
import type { MemoriUIMessage, Session } from "@/shared/lib/memori";

import { AssistantTurn, StatusMarker } from "./assistant-turn";
import { Composer } from "./composer";
import { TraceMarker } from "./trace-marker";

function userText(message: MemoriUIMessage) {
  return message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
}

export function ChatPage({
  session,
  initialMessages,
}: {
  session: Session;
  initialMessages: MemoriUIMessage[];
}) {
  const router = useRouter();
  const { setBusy } = useChatBusy();
  const [transport] = useState(
    () =>
      new DefaultChatTransport<MemoriUIMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { sessionId: session.id, message: messages.at(-1) },
        }),
      }),
  );
  const { messages, sendMessage, status, error } = useChat<MemoriUIMessage>({
    id: session.id,
    messages: initialMessages,
    transport,
    onFinish: () => {
      void router.invalidate();
    },
  });
  const busy = status === "submitted" || status === "streaming";
  const lastId = messages.at(-1)?.id;

  useEffect(() => {
    setBusy(busy);
  }, [busy, setBusy]);

  return (
    <div className="flex h-svh flex-col">
      <PageHeader title={session.title || "New chat"} />
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="mx-auto w-full max-w-3xl p-4">
              {messages.length === 0 && !busy ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <IconMessages />
                    </EmptyMedia>
                    <EmptyTitle>Start a conversation</EmptyTitle>
                    <EmptyDescription>
                      Each turn shows the retrieved memories, the injected prompt, and the
                      curation calls.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : null}
              {messages.map((message) => (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === "user"}
                >
                  {message.role === "user" ? (
                    <Message align="end">
                      <MessageContent>
                        <Bubble align="end">
                          <BubbleContent className="whitespace-pre-wrap">
                            {userText(message)}
                          </BubbleContent>
                        </Bubble>
                      </MessageContent>
                    </Message>
                  ) : (
                    <AssistantTurn
                      message={message}
                      streaming={busy && message.id === lastId}
                    />
                  )}
                </MessageScrollerItem>
              ))}
              {status === "submitted" ? (
                <MessageScrollerItem messageId="pending">
                  <StatusMarker label="Retrieving memories" />
                </MessageScrollerItem>
              ) : null}
              {session.status === "ended" ? (
                <MessageScrollerItem messageId="ended">
                  <TraceMarker
                    variant="separator"
                    icon={<IconFlag />}
                    label="Session ended"
                  >
                    <p className="text-sm text-muted-foreground">
                      {session.summary || "No summary."}
                    </p>
                  </TraceMarker>
                </MessageScrollerItem>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      {session.status === "active" ? (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 p-4">
          {error ? (
            <Alert variant="destructive">
              <IconAlertCircle />
              <AlertTitle>Request failed</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          ) : null}
          <Composer busy={busy} onSend={(text) => void sendMessage({ text })} />
        </div>
      ) : null}
    </div>
  );
}
