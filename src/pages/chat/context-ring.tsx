import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/shared/components/ui/hover-card";
import { formatNumber } from "@/shared/lib/format";
import { CONTEXT_WINDOW } from "@/shared/lib/memori";

const RADIUS = 8;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ContextRing({ tokens }: { tokens: number }) {
  const ratio = Math.min(tokens / CONTEXT_WINDOW, 1);
  const percent = Math.round(ratio * 100);
  const rows = [
    ["Used", formatNumber(tokens)],
    ["Remaining", formatNumber(Math.max(CONTEXT_WINDOW - tokens, 0))],
    ["Window", formatNumber(CONTEXT_WINDOW)],
  ];

  return (
    <HoverCard>
      <HoverCardTrigger
        delay={100}
        render={
          <div className="flex size-9 cursor-default items-center justify-center rounded-full transition-colors hover:bg-accent" />
        }
      >
        <svg
          viewBox="0 0 20 20"
          className="size-5 -rotate-90"
          aria-label={`${percent}% of context used`}
        >
          <circle
            cx="10"
            cy="10"
            r={RADIUS}
            fill="none"
            strokeWidth="2.5"
            className="stroke-border"
          />
          <circle
            cx="10"
            cy="10"
            r={RADIUS}
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
            className="stroke-muted-foreground transition-[stroke-dashoffset] duration-500"
          />
        </svg>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="w-60">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="font-medium">Context window</span>
          <span className="text-muted-foreground">{percent}%</span>
        </div>
        <dl className="flex flex-col gap-1">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          Past 50%, the oldest half of the chat is summarized into an episode.
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}
