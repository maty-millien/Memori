import { IconBrain, IconLayoutSidebar } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Button } from "@/shared/components/ui/button";
import { useSidebar } from "@/shared/components/ui/sidebar";

export function PageHeader({ children }: { children?: ReactNode }) {
  const { toggleSidebar, open, isMobile } = useSidebar();

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 px-4 sm:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="-ml-2 size-9 text-muted-foreground hover:text-foreground"
        onClick={toggleSidebar}
      >
        <IconLayoutSidebar className="size-5" />
        <span className="sr-only">Toggle sidebar</span>
      </Button>
      {!open || isMobile ? (
        <Link
          to="/"
          className="inline-flex items-center text-xl font-medium tracking-tight"
        >
          <IconBrain className="mr-1 size-4" />
          Memori
        </Link>
      ) : null}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </header>
  );
}
