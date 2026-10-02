import type { ReactNode } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shared/components/ui/collapsible";
import { Marker, MarkerContent, MarkerIcon } from "@/shared/components/ui/marker";
import { cn } from "@/shared/lib/utils";

export function TraceMarker({
  icon,
  label,
  shimmer = false,
  variant = "default",
  children,
}: {
  icon?: ReactNode;
  label: ReactNode;
  shimmer?: boolean;
  variant?: "default" | "separator";
  children: ReactNode;
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger
        nativeButton={false}
        render={<Marker variant={variant} className="cursor-pointer" />}
      >
        {icon ? <MarkerIcon>{icon}</MarkerIcon> : null}
        <MarkerContent className={cn(shimmer && "shimmer")}>{label}</MarkerContent>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}
