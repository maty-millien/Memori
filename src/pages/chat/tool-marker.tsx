import {
  IconAlertCircle,
  IconDeviceFloppy,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";

import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@/shared/components/ui/table";
import type { MemoriUIMessage } from "@/shared/lib/memori";

import { TraceMarker } from "./trace-marker";

export type ToolPart = Extract<
  MemoriUIMessage["parts"][number],
  { type: "tool-memory_upsert" | "tool-memory_delete" }
>;

const RESULT = /^(created|updated|deleted) memory with id "(.+)"$/;

const VERBS = {
  created: { label: "Saved memory", icon: <IconDeviceFloppy /> },
  updated: { label: "Updated memory", icon: <IconPencil /> },
  deleted: { label: "Deleted memory", icon: <IconTrash /> },
} as const;

function describe(part: ToolPart) {
  if (part.state === "output-error") {
    return { label: "Memory tool failed", icon: <IconAlertCircle />, pending: false };
  }
  if (part.state === "output-available") {
    const match = RESULT.exec(part.output);
    const verb = match?.[1];
    if (match && (verb === "created" || verb === "updated" || verb === "deleted")) {
      return {
        label: `${VERBS[verb].label} ${match[2]}`,
        icon: VERBS[verb].icon,
        pending: false,
      };
    }
    return { label: part.output, icon: <IconAlertCircle />, pending: false };
  }
  return part.type === "tool-memory_delete"
    ? { label: "Deleting memory", icon: <IconTrash />, pending: true }
    : { label: "Saving memory", icon: <IconDeviceFloppy />, pending: true };
}

function formatValue(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function ToolMarker({ part }: { part: ToolPart }) {
  const { label, icon, pending } = describe(part);
  return (
    <TraceMarker icon={icon} label={label} shimmer={pending}>
      <div className="flex flex-col gap-2">
        <Table>
          <TableBody>
            <TableRow>
              <TableHead>tool</TableHead>
              <TableCell>{part.type.replace("tool-", "")}</TableCell>
            </TableRow>
            {Object.entries(part.input ?? {}).map(([key, value]) => (
              <TableRow key={key}>
                <TableHead>{key}</TableHead>
                <TableCell className="whitespace-normal">{formatValue(value)}</TableCell>
              </TableRow>
            ))}
            {part.state === "output-available" ? (
              <TableRow>
                <TableHead>result</TableHead>
                <TableCell className="whitespace-normal">{part.output}</TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        {part.state === "output-error" ? (
          <Alert variant="destructive">
            <IconAlertCircle />
            <AlertTitle>Tool error</AlertTitle>
            <AlertDescription>{part.errorText}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </TraceMarker>
  );
}
