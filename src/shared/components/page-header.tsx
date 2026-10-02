import {
  IconBrain,
  IconMenu2,
  IconMessageCircle,
  IconStack2,
  IconTrash,
} from "@tabler/icons-react";
import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { resetEverything, triggerEpisode } from "@/server/functions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Spinner } from "@/shared/components/ui/spinner";
import { cn } from "@/shared/lib/utils";

const LINKS = [
  { to: "/", label: "Chat", icon: IconMessageCircle },
  { to: "/memories", label: "Memories", icon: IconBrain },
] as const;

async function reset() {
  await resetEverything();
  window.location.assign("/");
}

export function PageHeader({ className }: { className?: string }) {
  const router = useRouter();
  const [summarizing, setSummarizing] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  async function newEpisode() {
    setSummarizing(true);
    try {
      await triggerEpisode();
      await router.invalidate();
    } finally {
      setSummarizing(false);
    }
  }

  return (
    <header
      className={cn("flex h-14 shrink-0 items-center gap-2 px-4 sm:px-6", className)}
    >
      <Link
        to="/"
        className="inline-flex items-center text-xl font-medium tracking-tight"
      >
        <IconBrain className="mr-1 size-4" />
        Memori
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="-mr-2 ml-auto size-9 text-muted-foreground hover:text-foreground"
            />
          }
        >
          <IconMenu2 className="size-5" />
          <span className="sr-only">Menu</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {LINKS.map(({ to, label, icon: Icon }) => (
            <DropdownMenuItem key={to} onClick={() => void router.navigate({ to })}>
              <Icon />
              {label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            closeOnClick={false}
            disabled={summarizing}
            onClick={() => void newEpisode()}
          >
            {summarizing ? <Spinner /> : <IconStack2 />}
            New episode
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setResetOpen(true)}>
            <IconTrash />
            Reset everything
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset everything?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the chat, every memory and episode, the model settings, and all
              attachments.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={reset}>
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}
