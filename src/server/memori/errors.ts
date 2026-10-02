import { NOT_SIGNED_IN } from "./codex";

export function errorMessage(error: unknown): string {
  let current: unknown = error;
  while (current instanceof Error) {
    if (current.message.includes(NOT_SIGNED_IN)) {
      return NOT_SIGNED_IN;
    }
    current = current.cause;
  }
  return error instanceof Error ? error.message : String(error);
}
