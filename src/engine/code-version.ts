import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { failure } from "./failure.ts";

/** The version of the code that runs: its commit, and whether its working tree had changes not committed. */
export interface CodeVersion {
  commit: string;
  uncommittedChanges: boolean;
}

/**
 * The version of the engine's code, read with git from the repository it lives in (FR-RECORD-02). It fails, saying
 * why, when git cannot tell: a run whose code is unknown cannot be reproduced.
 */
export function codeVersion(): CodeVersion {
  const git = (...args: string[]) => {
    try {
      return execFileSync("git", args, { cwd: dirname(fileURLToPath(import.meta.url)), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      throw failure(`the commit of the code that runs cannot be read with "git ${args.join(" ")}"`, error);
    }
  };
  return { commit: git("rev-parse", "HEAD").trim(), uncommittedChanges: git("status", "--porcelain").trim() !== "" };
}
