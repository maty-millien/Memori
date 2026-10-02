import { useChat } from "@ai-sdk/react";
import { IconAlertCircle } from "@tabler/icons-react";
import { useRouter } from "@tanstack/react-router";
import { DefaultChatTransport } from "ai";
import { useState } from "react";

import { saveChatSettings } from "@/server/functions";
import { PageHeader } from "@/shared/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/shared/components/ui/message-scroller";
import type { ChatModel, ChatSettings, MemoriUIMessage } from "@/shared/lib/memori";

import { AssistantTurn } from "./assistant-turn";
import { Composer } from "./composer";
import { UserTurn } from "./user-turn";

function contextTokens(messages: MemoriUIMessage[]) {
  for (const message of messages.toReversed()) {
    for (const part of message.parts) {
      if (part.type === "data-usage") {
        return (
          part.data.context ?? part.data.chat.inputTokens + part.data.chat.outputTokens
        );
      }
    }
  }
  return 0;
}

export function ChatPage({
  initialMessages,
  models,
  initialChatSettings,
}: {
  initialMessages: MemoriUIMessage[];
  models: ChatModel[];
  initialChatSettings: ChatSettings;
}) {
  const router = useRouter();
  const [chatSettings, setChatSettings] = useState(initialChatSettings);
  const [transport] = useState(
    () =>
      new DefaultChatTransport<MemoriUIMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { message: messages.at(-1) },
        }),
      }),
  );
  const { messages, sendMessage, status, error } = useChat<MemoriUIMessage>({
    messages: initialMessages,
    transport,
    onFinish: () => {
      void router.invalidate();
    },
  });
  const busy = status === "submitted" || status === "streaming";
  const lastId = messages.at(-1)?.id;

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
        onSend={(text, files) => {
          const transfer = new DataTransfer();
          for (const file of files) {
            transfer.items.add(file);
          }
          void sendMessage({ text, files: transfer.files });
        }}
      />
    </div>
  );

  if (messages.length === 0 && !busy) {
    return (
      <div className="flex h-svh flex-col">
        <PageHeader />
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
      <PageHeader className="absolute inset-x-0 top-0 z-10" />
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport className="[--scroll-fade-t-size:--spacing(16)]">
            <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-10 px-6 pt-18 pb-10">
              {messages.map((message) => (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === "user"}
                  className="-mx-2 px-2"
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
