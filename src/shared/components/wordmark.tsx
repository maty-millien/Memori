import { AppLogo } from "@/shared/components/app-logo";
import { cn } from "@/shared/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[0.3em] text-xl font-medium tracking-tight",
        className,
      )}
    >
      <AppLogo className="h-[1.15cap] w-auto shrink-0" />
      <span className="[text-box:trim-both_cap_alphabetic]">Memori</span>
    </span>
  );
}
