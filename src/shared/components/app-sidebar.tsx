import { IconBrain, IconMessageCircle } from "@tabler/icons-react";
import { Link, useLocation } from "@tanstack/react-router";

import { Sidebar, SidebarContent, SidebarHeader } from "@/shared/components/ui/sidebar";
import { cn } from "@/shared/lib/utils";

const LINKS = [
  { to: "/", label: "Chat", icon: IconMessageCircle },
  { to: "/memories", label: "Memories", icon: IconBrain },
] as const;

export function AppSidebar() {
  const { pathname } = useLocation();

  return (
    <Sidebar className="border-r border-border/40">
      <SidebarHeader className="h-14 flex-row items-center px-5">
        <Link
          to="/"
          className="inline-flex items-center text-xl font-medium tracking-tight"
        >
          <IconBrain className="mr-1 size-4" />
          Memori
        </Link>
      </SidebarHeader>
      <SidebarContent className="border-t border-border/40 px-3">
        <nav className="mt-3 mb-5 flex flex-col">
          {LINKS.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                "inline-flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-primary transition-colors hover:bg-accent/80 hover:text-foreground",
                pathname === to && "bg-accent",
              )}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          ))}
        </nav>
      </SidebarContent>
    </Sidebar>
  );
}
