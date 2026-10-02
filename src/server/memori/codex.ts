import { spawn } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const MODEL = "gpt-6-luna";
const REASONING_EFFORT = "low";

const CODEX_HOME = resolve(".memori/codex");

type CodexItem =
  | { id: string; type: "agent_message" | "reasoning"; text: string }
  | {
      id: string;
      type: "command_execution";
      command: string;
      aggregated_output: string;
      exit_code?: number | null;
    }
  | { id: string; type: "web_search"; query: string };

export type CodexUsage = {
  input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
};

type CodexEvent =
  | { type: "item.started" | "item.completed"; item: CodexItem }
  | { type: "turn.completed"; usage: CodexUsage }
  | { type: "turn.failed"; error: { message: string } }
  | { type: "error"; message: string };

type CodexRun = {
  name: string;
  instructions: string;
  prompt: string;
  model?: string;
  effort?: string;
  images?: string[];
  schema?: unknown;
  webSearch?: boolean;
  onEvent?: (event: CodexEvent) => void;
};

function prepare(name: string, instructions: string, schema: unknown) {
  mkdirSync(CODEX_HOME, { recursive: true });
  const auth = join(CODEX_HOME, "auth.json");
  if (!existsSync(auth)) {
    symlinkSync(
      join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json"),
      auth,
    );
  }
  const instructionsFile = join(CODEX_HOME, `${name}.md`);
  writeFileSync(instructionsFile, instructions);
  if (schema === undefined) {
    return { instructionsFile, schemaFile: undefined };
  }
  const schemaFile = join(CODEX_HOME, `${name}.schema.json`);
  writeFileSync(schemaFile, JSON.stringify(schema));
  return { instructionsFile, schemaFile };
}

export function runCodex({
  name,
  instructions,
  prompt,
  model = MODEL,
  effort = REASONING_EFFORT,
  images = [],
  schema,
  webSearch = false,
  onEvent,
}: CodexRun) {
  const { instructionsFile, schemaFile } = prepare(name, instructions, schema);
  const args = [
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
    "--cd",
    tmpdir(),
    "--model",
    model,
    "--config",
    `model_reasoning_effort="${effort}"`,
    "--config",
    `model_instructions_file="${instructionsFile}"`,
    "--config",
    `web_search="${webSearch ? "live" : "disabled"}"`,
    ...(schemaFile ? ["--output-schema", schemaFile] : []),
    ...images.flatMap((image) => ["--image", image]),
  ];
  const child = spawn("codex", args, { env: { ...process.env, CODEX_HOME } });
  child.stdin.end(prompt);

  return new Promise<{ text: string; usage: CodexUsage }>((resolvePromise, reject) => {
    let text = "";
    let usage: CodexUsage | undefined;
    let failure: string | undefined;
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    createInterface({ input: child.stdout }).on("line", (line) => {
      const event: CodexEvent = JSON.parse(line);
      if (event.type === "item.completed" && event.item.type === "agent_message") {
        text = event.item.text;
      }
      if (event.type === "turn.completed") {
        usage = event.usage;
      }
      if (event.type === "turn.failed") {
        failure = event.error.message;
      }
      if (event.type === "error") {
        failure = event.message;
      }
      onEvent?.(event);
    });
    child.on("error", reject);
    child.on("close", () => {
      if (usage && !failure) {
        resolvePromise({ text, usage });
      } else {
        reject(new Error(failure ?? (stderr.trim() || "Codex exited without a reply")));
      }
    });
  });
}
