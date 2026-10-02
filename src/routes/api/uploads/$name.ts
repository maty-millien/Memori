import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createFileRoute } from "@tanstack/react-router";

import { EXTENSIONS, UPLOADS_DIR } from "@/server/memori/uploads";

const NAME = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\.(\w+)$/;
const TYPES = new Map<string, string>(
  Object.entries(EXTENSIONS).map(([type, ext]) => [ext, type]),
);

export const Route = createFileRoute("/api/uploads/$name")({
  server: {
    handlers: {
      GET: ({ params }) => {
        const type = TYPES.get(NAME.exec(params.name)?.[1] ?? "");
        const path = join(UPLOADS_DIR, params.name);
        if (!type || !existsSync(path)) {
          return new Response("Not found", { status: 404 });
        }
        return new Response(readFileSync(path), { headers: { "Content-Type": type } });
      },
    },
  },
});
