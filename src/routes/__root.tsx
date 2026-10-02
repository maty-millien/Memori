import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { getSessions } from "@/server/functions";
import { AppSidebar } from "@/shared/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/shared/components/ui/sidebar";
import { TooltipProvider } from "@/shared/components/ui/tooltip";
import { ChatBusyProvider } from "@/shared/lib/chat-busy";

import appCss from "../global.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Memori" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  loader: () => getSessions(),
  shellComponent: RootDocument,
  component: RootLayout,
});

const THEME_SCRIPT = `document.documentElement.classList.toggle("dark", matchMedia("(prefers-color-scheme: dark)").matches)`;

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootLayout() {
  const sessions = Route.useLoaderData();
  return (
    <TooltipProvider>
      <ChatBusyProvider>
        <SidebarProvider>
          <AppSidebar sessions={sessions} />
          <SidebarInset className="min-w-0">
            <Outlet />
          </SidebarInset>
        </SidebarProvider>
      </ChatBusyProvider>
    </TooltipProvider>
  );
}
