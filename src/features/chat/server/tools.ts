import { spawn } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, resolve } from "node:path";

export const SHELL_PATH = process.env.SHELL || "/bin/sh";
export const SHELL_TIMEOUT_MS = 120_000;
export const SHELL_MAX_LINES = 2_000;
const SHELL_MAX_BYTES = 50 * 1024;
const SHELL_OUTPUT_DIR = ".memori/shell";

export const READ_MAX_LINES = 2_000;
const READ_MAX_LINE_LENGTH = 2_000;
const READ_MAX_BYTES = 50 * 1024;
const READ_MAX_FILE_BYTES = 20 * 1024 * 1024;
const MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
};

type ShellResult = { output: string; exitCode: number | null };

const homePath = (path: string) =>
  resolve(homedir(), path.replace(/^~(?=$|\/)/, homedir()));

export function shell(
  command: string,
  workdir: string | null,
  timeout: number | null,
  signal: AbortSignal,
) {
  const cwd = homePath(workdir ?? ".");
  if (!statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
    return Promise.resolve<ShellResult>({
      output: `Working directory is not a directory: ${cwd}`,
      exitCode: null,
    });
  }
  const ms = timeout ?? SHELL_TIMEOUT_MS;
  return new Promise<ShellResult>((done) => {
    const child = spawn(SHELL_PATH, ["-c", command], {
      cwd,
      env: { ...process.env, TERM: "xterm-256color", AGENT: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    const kill = (killSignal: NodeJS.Signals) => {
      try {
        process.kill(-child.pid!, killSignal);
      } catch {}
    };
    let ended: "timeout" | "stopped" | null = null;
    const end = (reason: "timeout" | "stopped") => {
      ended = reason;
      kill("SIGTERM");
      setTimeout(() => kill("SIGKILL"), 3_000).unref();
    };
    const timer = ms > 0 ? setTimeout(() => end("timeout"), ms) : undefined;
    const stop = () => end("stopped");
    signal.addEventListener("abort", stop, { once: true });
    child.on("close", (exitCode, killedBy) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      const text = Buffer.concat(chunks).toString("utf8");
      const lines = text.replace(/\n$/, "").split("\n");
      let shown = lines.slice(-SHELL_MAX_LINES).join("\n");
      if (Buffer.byteLength(shown) > SHELL_MAX_BYTES) {
        shown = Buffer.from(shown).subarray(-SHELL_MAX_BYTES).toString("utf8");
      }
      let body = shown || "(no output)";
      if (shown.length < lines.join("\n").length) {
        mkdirSync(SHELL_OUTPUT_DIR, { recursive: true });
        const file = resolve(SHELL_OUTPUT_DIR, `${crypto.randomUUID()}.out`);
        writeFileSync(file, text);
        const count = shown.split("\n").length;
        body += `\n\n[showing lines ${lines.length - count + 1}-${lines.length} of ${lines.length}; full output saved to ${file}]`;
      }
      const status =
        ended === "timeout"
          ? `Command exceeded timeout of ${ms} ms. Retry with a larger timeout if the command is expected to take longer.`
          : ended === "stopped"
            ? "Stopped by the user"
            : killedBy
              ? `Killed by ${killedBy}`
              : exitCode !== 0
                ? `Exited with code ${exitCode}`
                : "";
      done({ output: [body, status].filter(Boolean).join("\n\n"), exitCode });
    });
  });
}

export function read(
  path: string,
  offset: number | null,
  limit: number | null,
  images: boolean,
) {
  const file = homePath(path);
  const stats = statSync(file, { throwIfNoEntry: false });
  if (!stats) {
    return `File not found: ${file}`;
  }
  let lines: string[];
  if (stats.isDirectory()) {
    lines = readdirSync(file, { withFileTypes: true })
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      .toSorted();
  } else {
    if (stats.size > READ_MAX_FILE_BYTES) {
      return `File is larger than 20 MB: ${file}`;
    }
    const bytes = readFileSync(file);
    const mediaType = MEDIA_TYPES[extname(file).toLowerCase()];
    const data = `data:${mediaType};base64,${bytes.toString("base64")}`;
    if (mediaType === "application/pdf") {
      return [{ type: "input_file", filename: basename(file), file_data: data }];
    }
    if (mediaType) {
      return images
        ? [{ type: "input_image", image_url: data }]
        : "The current model can't view images.";
    }
    if (bytes.subarray(0, 8192).includes(0)) {
      return `Cannot read binary file: ${file}`;
    }
    if (bytes.length === 0) {
      return "(empty file)";
    }
    lines = bytes
      .toString("utf8")
      .replace(/\n$/, "")
      .split("\n")
      .map((line, index) =>
        line.length > READ_MAX_LINE_LENGTH
          ? `${index + 1}: ${line.slice(0, READ_MAX_LINE_LENGTH)}... (line truncated)`
          : `${index + 1}: ${line}`,
      );
  }
  const start = Math.max(offset ?? 1, 1) - 1;
  const shown: string[] = [];
  let size = 0;
  for (const line of lines.slice(
    start,
    start + Math.min(limit ?? READ_MAX_LINES, READ_MAX_LINES),
  )) {
    size += Buffer.byteLength(line) + 1;
    if (size > READ_MAX_BYTES) {
      break;
    }
    shown.push(line);
  }
  const end = start + shown.length;
  const note =
    end < lines.length
      ? `\n\n(Showing ${start + 1}-${end} of ${lines.length}. Use offset ${end + 1} to read more.)`
      : "";
  return (
    (shown.join("\n") ||
      `Nothing at offset ${start + 1}: there are ${lines.length} lines.`) + note
  );
}

type Chunk = {
  oldLines: string[];
  newLines: string[];
  context?: string;
  endOfFile: boolean;
};
type Hunk =
  | { type: "add"; path: string; contents: string }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; movePath?: string; chunks: Chunk[] };

const isHeader = (line: string) => /^\*\*\* (Add|Delete|Update) File: /.test(line.trim());

function parsePatch(text: string) {
  const lines = text
    .trim()
    .split("\n")
    .map((line) => line.replace(/\r$/, ""));
  if (lines[0]?.trim() !== "*** Begin Patch") {
    throw new Error("The first line of the patch must be '*** Begin Patch'");
  }
  if (lines.length < 2 || lines.at(-1)?.trim() !== "*** End Patch") {
    throw new Error("The last line of the patch must be '*** End Patch'");
  }
  const end = lines.length - 1;
  const hunks: Hunk[] = [];
  let index = 1;
  while (index < end) {
    const header = lines[index].trim();
    const [, action, path] = /^\*\*\* (Add|Delete|Update) File: (.+)$/.exec(header) ?? [];
    if (!action) {
      throw new Error(
        `Invalid hunk at line ${index + 1}: '${header}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`,
      );
    }
    index++;
    if (action === "Delete") {
      hunks.push({ type: "delete", path });
      continue;
    }
    if (action === "Add") {
      const contents: string[] = [];
      for (; index < end && !isHeader(lines[index]); index++) {
        if (!lines[index].startsWith("+")) {
          throw new Error(
            `Invalid Add File line ${index + 1} for '${path}': expected a line starting with '+'`,
          );
        }
        contents.push(lines[index].slice(1));
      }
      hunks.push({ type: "add", path, contents: contents.join("\n") });
      continue;
    }
    const movePath = /^\*\*\* Move to: (.+)$/.exec(lines[index]?.trim() ?? "")?.[1];
    if (movePath) {
      index++;
    }
    const chunks: Chunk[] = [];
    for (; index < end && !isHeader(lines[index]); index++) {
      const line = lines[index];
      const marker = line.trimEnd();
      if (marker === "*** End of File") {
        const last = chunks.at(-1);
        if (last) {
          last.endOfFile = true;
        }
        continue;
      }
      if (marker === "@@" || marker.startsWith("@@ ")) {
        chunks.push({
          oldLines: [],
          newLines: [],
          context: marker.slice(3) || undefined,
          endOfFile: false,
        });
        continue;
      }
      if (chunks.length === 0) {
        chunks.push({ oldLines: [], newLines: [], endOfFile: false });
      }
      const chunk = chunks.at(-1)!;
      if (line === "" || line.startsWith(" ")) {
        chunk.oldLines.push(line.slice(1));
        chunk.newLines.push(line.slice(1));
      } else if (line.startsWith("-")) {
        chunk.oldLines.push(line.slice(1));
      } else if (line.startsWith("+")) {
        chunk.newLines.push(line.slice(1));
      } else {
        throw new Error(
          `Unexpected line ${index + 1} in update hunk for '${path}': '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
        );
      }
    }
    if (!chunks.some((chunk) => chunk.oldLines.length > 0 || chunk.newLines.length > 0)) {
      throw new Error(`Update file hunk for path '${path}' is empty`);
    }
    hunks.push({ type: "update", path, movePath: movePath?.trim(), chunks });
  }
  return hunks;
}

const normalize = (value: string) =>
  value
    .trim()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/[  -   　]/g, " ");

const COMPARISONS = [
  (left: string, right: string) => left === right,
  (left: string, right: string) => left.trimEnd() === right.trimEnd(),
  (left: string, right: string) => left.trim() === right.trim(),
  (left: string, right: string) => normalize(left) === normalize(right),
];

function seek(lines: string[], pattern: string[], start: number, endOfFile: boolean) {
  const offsets = endOfFile
    ? [lines.length - pattern.length]
    : Array.from(
        { length: lines.length - pattern.length - start + 1 },
        (_, index) => start + index,
      );
  for (const compare of COMPARISONS) {
    const found = offsets.find(
      (offset) =>
        offset >= start &&
        pattern.every((line, index) => compare(lines[offset + index], line)),
    );
    if (found !== undefined) {
      return found;
    }
  }
  return -1;
}

function applyChunks(file: string, original: string, chunks: Chunk[]) {
  const lines = original.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  const replacements: [number, number, string[]][] = [];
  let from = 0;
  for (const chunk of chunks) {
    if (chunk.context) {
      const found = seek(lines, [chunk.context], from, false);
      if (found === -1) {
        throw new Error(`Failed to find context '${chunk.context}' in ${file}`);
      }
      from = found + 1;
    }
    if (chunk.oldLines.length === 0) {
      replacements.push([lines.length, 0, chunk.newLines]);
      continue;
    }
    let { oldLines, newLines } = chunk;
    let found = seek(lines, oldLines, from, chunk.endOfFile);
    if (found === -1 && oldLines.at(-1) === "") {
      oldLines = oldLines.slice(0, -1);
      newLines = newLines.at(-1) === "" ? newLines.slice(0, -1) : newLines;
      found = seek(lines, oldLines, from, chunk.endOfFile);
    }
    if (found === -1) {
      throw new Error(
        `Failed to find expected lines in ${file}:\n${chunk.oldLines.join("\n")}`,
      );
    }
    replacements.push([found, oldLines.length, newLines]);
    from = found + oldLines.length;
  }
  for (const [start, remove, insert] of replacements.toSorted((a, b) => b[0] - a[0])) {
    lines.splice(start, remove, ...insert);
  }
  if (lines.at(-1) !== "") {
    lines.push("");
  }
  return lines.join("\n");
}

export function applyPatch(text: string) {
  const changes: {
    status: "A" | "M" | "D";
    file: string;
    content?: string;
    remove?: string;
  }[] = [];
  const updated = new Map<string, string>();
  for (const hunk of parsePatch(text)) {
    const file = homePath(hunk.path);
    if (hunk.type === "add") {
      const content =
        hunk.contents === "" || hunk.contents.endsWith("\n")
          ? hunk.contents
          : `${hunk.contents}\n`;
      changes.push({ status: "A", file, content });
      continue;
    }
    if (!statSync(file, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`File does not exist: ${file}`);
    }
    if (hunk.type === "delete") {
      changes.push({ status: "D", file, remove: file });
      continue;
    }
    const content = applyChunks(
      file,
      updated.get(file) ?? readFileSync(file, "utf8"),
      hunk.chunks,
    );
    if (hunk.movePath) {
      changes.push({ status: "M", file: homePath(hunk.movePath), content, remove: file });
    } else {
      updated.set(file, content);
      changes.push({ status: "M", file, content });
    }
  }
  for (const change of changes) {
    if (change.content !== undefined) {
      mkdirSync(dirname(change.file), { recursive: true });
      writeFileSync(change.file, change.content);
    }
    if (change.remove) {
      unlinkSync(change.remove);
    }
  }
  return [
    "Success. Updated the following files:",
    ...changes.map((change) => `${change.status} ${change.file}`),
  ].join("\n");
}
