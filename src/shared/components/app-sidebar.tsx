import { IconBrain, IconPlus } from "@tabler/icons-react";
import { Link, useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { newChat } from "@/server/functions";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/components/ui/sidebar";
import { Spinner } from "@/shared/components/ui/spinner";
import { useChatBusy } from "@/shared/lib/chat-busy";
import type { Session } from "@/shared/lib/memori";

export function AppSidebar({ sessions }: { sessions: Session[] }) {
  const { busy } = useChatBusy();
  const router = useRouter();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [starting, setStarting] = useState(false);

  async function startChat() {
    setStarting(true);
    try {
      const sessionId = await newChat();
      await router.invalidate();
      await navigate({ to: "/sessions/$sessionId", params: { sessionId } });
    } finally {
      setStarting(false);
    }
  }

  const groups = [
    { label: "Active", items: sessions.filter((session) => session.status === "active") },
    { label: "Ended", items: sessions.filter((session) => session.status === "ended") },
  ];

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={startChat} disabled={busy || starting}>
              {starting ? <Spinner /> : <IconPlus />}
              <span>New chat</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link to="/memories" />}
              isActive={pathname === "/memories"}
            >
              <IconBrain />
              <span>Memories</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) =>
          group.items.length > 0 ? (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((session) => (
                    <SidebarMenuItem key={session.id}>
                      <SidebarMenuButton
                        render={
                          <Link
                            to="/sessions/$sessionId"
                            params={{ sessionId: session.id }}
                          />
                        }
                        isActive={pathname === `/sessions/${session.id}`}
                      >
                        <span>{session.title || "New chat"}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ) : null,
        )}
      </SidebarContent>
    </Sidebar>
  );
}
