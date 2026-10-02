import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import type { AttachmentType } from "@/shared/lib/memori";

export const UPLOADS_DIR = ".memori/uploads";
export const UPLOAD_URL = "/api/uploads/";

export const EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
} as const satisfies Record<AttachmentType, string>;

export function saveUpload(bytes: Uint8Array, mediaType: AttachmentType) {
  mkdirSync(UPLOADS_DIR, { recursive: true });
  const name = `${crypto.randomUUID()}.${EXTENSIONS[mediaType]}`;
  writeFileSync(join(UPLOADS_DIR, name), bytes);
  return UPLOAD_URL + name;
}

export function readUpload(url: string) {
  return readFileSync(join(UPLOADS_DIR, basename(url)));
}
