import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { After, Before } from "@cucumber/cucumber";
import type { Context } from "./context.ts";

// A run opens Pi sessions under the home directory (~/.agents-lab/pi/), and Pi falls back to ~/.pi/agent/: each
// scenario gets a home of its own, so no scenario reads or writes the person's.
const personsHome = process.env.HOME;

Before(function (this: Context) {
  this.home = mkdtempSync(join(tmpdir(), "agents-lab-home-"));
  process.env.HOME = this.home;
});

After(function (this: Context) {
  process.env.HOME = personsHome;
  rmSync(this.home, { recursive: true, force: true });
});
