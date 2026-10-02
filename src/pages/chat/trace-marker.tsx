import type { ReactNode } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shared/components/ui/collapsible";
import { Marker, MarkerContent, MarkerIcon } from "@/shared/components/ui/marker";
import { Spinner } from "@/shared/components/ui/spinner";
import { cn } from "@/shared/lib/utils";

export function TraceMarker({
  icon,
  label,
  shimmer = false,
  children,
}: {
  icon?: ReactNode;
  label: ReactNode;
  shimmer?: boolean;
  children: ReactNode;
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger
        nativeButton={false}
        render={<Marker className="cursor-pointer" />}
      >
        {icon ? <MarkerIcon>{icon}</MarkerIcon> : null}
        <MarkerContent className={cn(shimmer && "shimmer")}>{label}</MarkerContent>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 text-sm text-muted-foreground">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function StatusMarker({ label }: { label: string }) {
  return (
    <Marker>
      <MarkerIcon>
        <Spinner />
      </MarkerIcon>
      <MarkerContent className="shimmer">{label}</MarkerContent>
    </Marker>
  );
}
