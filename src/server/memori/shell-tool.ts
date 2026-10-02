import { exec } from "node:child_process";
import { homedir } from "node:os";

import { tool } from "ai";
import { z } from "zod";

import type { ShellOutput } from "@/shared/lib/memori";

const MAX_OUTPUT = 20_000;

const clip = (output: string) =>
  output.length > MAX_OUTPUT ? `[truncated]\n${output.slice(-MAX_OUTPUT)}` : output;

export const shellTool = tool({
  description:
    "Run a zsh command on the user's Mac and return its exit code, stdout, and stderr. Commands start in the home directory and time out after 2 minutes.",
  inputSchema: z.object({ command: z.string() }),
  execute: ({ command }) =>
    new Promise<ShellOutput>((resolve) => {
      exec(
        command,
        {
          shell: "/bin/zsh",
          cwd: homedir(),
          timeout: 120_000,
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          resolve({
            exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
            stdout: clip(stdout),
            stderr: clip(stderr || (error?.message ?? "")),
          });
        },
      );
    }),
});
