import { Chat, useChat } from "@ai-sdk/react";
import { IconAlertCircle } from "@tabler/icons-react";
import { useRouter, type AnyRouter } from "@tanstack/react-router";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";

import { saveChatSettings, steerChat, stopChat } from "@/features/chat/server/functions";
import type {
  ChatModel,
  ChatSettings,
  Episode,
  MemoriUIMessage,
  Memory,
} from "@/shared/lib/memori";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/shared/ui/message-scroller";

import { AssistantTurn } from "./assistant-turn";
import { Composer } from "./composer";
import { PageHeader } from "./page-header";
import { UserTurn } from "./user-turn";

let browserChat: Chat<MemoriUIMessage> | undefined;

function getChat(initialMessages: MemoriUIMessage[], router: AnyRouter) {
  const create = () =>
    new Chat<MemoriUIMessage>({
      messages: initialMessages,
      transport: new DefaultChatTransport<MemoriUIMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { message: messages.at(-1) },
        }),
        prepareReconnectToStreamRequest: () => ({ api: "/api/chat" }),
      }),
      onFinish: () => {
        void router.invalidate();
      },
    });
  if (typeof window === "undefined") {
    return create();
  }
  browserChat ??= create();
  return browserChat;
}

function contextTokens(messages: MemoriUIMessage[]) {
  for (const message of messages.toReversed()) {
    for (const part of message.parts) {
      if (part.type === "data-usage") {
        return part.data.context;
      }
    }
  }
  return 0;
}

export function ChatPage({
  initialMessages,
  models,
  initialChatSettings,
  memories,
  conversations,
}: {
  initialMessages: MemoriUIMessage[];
  models: ChatModel[];
  initialChatSettings: ChatSettings;
  memories: Memory[];
  conversations: Episode[];
}) {
  const router = useRouter();
  const [chatSettings, setChatSettings] = useState(initialChatSettings);
  const [chat] = useState(() => getChat(initialMessages, router));
  const { messages, sendMessage, status, error } = useChat({ chat, resume: true });
  const busy = status === "submitted" || status === "streaming";
  const queued = useRef<string[]>([]);

  useEffect(() => {
    if (!busy && queued.current.length > 0) {
      void sendMessage({ text: queued.current.splice(0).join("\n\n") });
    }
  }, [busy, sendMessage]);
  const lastId = messages.at(-1)?.id;
  const header = (className?: string) => (
    <PageHeader className={className} memories={memories} conversations={conversations} />
  );

  const composer = (
    <div className="flex w-full flex-col gap-2 px-2 pb-3 sm:pb-4">
      {error ? (
        <Alert variant="destructive">
          <IconAlertCircle />
          <AlertTitle>Request failed</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : null}
      <Composer
        busy={busy}
        contextTokens={contextTokens(messages)}
        models={models}
        chatSettings={chatSettings}
        onChatSettingsChange={(settings) => {
          setChatSettings(settings);
          void saveChatSettings({ data: settings });
        }}
        onSend={(text) => {
          if (!busy) {
            void sendMessage({ text });
            return;
          }
          void steerChat({ data: { text } }).then((accepted) => {
            if (accepted) {
              return;
            }
            if (chat.status === "ready" || chat.status === "error") {
              void sendMessage({ text });
            } else {
              queued.current.push(text);
            }
          });
        }}
        onStop={() => void stopChat()}
      />
    </div>
  );

  if (messages.length === 0 && !busy) {
    return (
      <div className="flex h-svh flex-col">
        {header()}
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-end pb-14 md:justify-center">
          <h1 className="mb-6 text-3xl font-medium tracking-tight">
            What's on your mind?
          </h1>
          {composer}
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-svh flex-col">
      {header("absolute inset-x-0 top-0 z-10")}
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport className="[--scroll-fade-t-size:--spacing(16)]">
            <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-10 px-6 pt-18 pb-24">
              {messages.map((message) => (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === "user"}
                  className="-mx-4 -my-2 px-4 py-2"
                >
                  {message.role === "user" ? (
                    <UserTurn message={message} />
                  ) : (
                    <AssistantTurn
                      message={message}
                      streaming={busy && message.id === lastId}
                    />
                  )}
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton className="rounded-full border-input bg-popover shadow-xs backdrop-blur-xl" />
        </MessageScroller>
      </MessageScrollerProvider>
      <div className="mx-auto w-full max-w-3xl">{composer}</div>
    </div>
  );
}
