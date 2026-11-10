import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { After, Before } from "@cucumber/cucumber";
import { filesUnder, personsPiDirectory } from "../steps/adapter.steps.ts";
import type { Context } from "./context.ts";

// A run opens Pi sessions under the home directory (~/.agents-lab/pi/), and Pi falls back to ~/.pi/agent/: each
// scenario gets a home of its own, so no scenario reads or writes the person's.
const personsHome = process.env.HOME;

Before({ tags: "not @smoke" }, function (this: Context) {
  this.home = mkdtempSync(join(tmpdir(), "agents-lab-home-"));
  process.env.HOME = this.home;
});

After({ tags: "not @smoke" }, function (this: Context) {
  process.env.HOME = personsHome;
  rmSync(this.home, { recursive: true, force: true });
});

// The smoke run uses the lab's real login, under the person's home: it checks that their Pi directory stays as it was.
Before({ tags: "@smoke" }, function (this: Context) {
  this.home = homedir();
  this.personsPiFiles = filesUnder(personsPiDirectory(this));
});
