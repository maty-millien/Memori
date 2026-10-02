import { Marker, MarkerContent, MarkerIcon } from "@/shared/components/ui/marker";
import { Spinner } from "@/shared/components/ui/spinner";

export function StatusMarker({ label }: { label: string }) {
  return (
    <Marker>
      <MarkerIcon>
        <Spinner />
      </MarkerIcon>
      <MarkerContent className="shimmer truncate">{label}</MarkerContent>
    </Marker>
  );
}
