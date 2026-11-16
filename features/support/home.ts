import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os, { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { After, Before } from "@cucumber/cucumber";
import { filesUnder, personsPiDirectory } from "../steps/adapter.steps.ts";
import type { Context } from "./context.ts";

// A run opens Pi sessions under the home directory (~/.agents-lab/pi/), and Pi falls back to ~/.pi/agent/: each
// scenario gets a home of its own, so no scenario reads or writes the person's. The home is the scenario's temporary
// directory too (os.tmpdir() reads TMPDIR), so whatever the scenario makes there is removed with it.
const personsHome = process.env.HOME;
const personsTmpdir = process.env.TMPDIR;

// Cucumber runs scenarios in worker threads, where os.homedir() reads the process's environment, not the thread's
// process.env, and would give the person's home whatever HOME the scenario sets. It reads the thread's HOME here, as in
// a process of its own, for the lab's code and Pi's alike.
const processHomedir = os.homedir;
os.homedir = () => process.env.HOME ?? processHomedir();
syncBuiltinESMExports();

Before({ tags: "not @smoke" }, function (this: Context) {
  this.home = mkdtempSync(join(tmpdir(), "agents-lab-home-"));
  process.env.HOME = this.home;
  process.env.TMPDIR = this.home;
  assert.equal(homedir(), this.home, "the lab and Pi would not see the scenario's home");
  this.logDirectory = join(this.home, "logs");
  mkdirSync(this.logDirectory);
});

After({ tags: "not @smoke" }, function (this: Context) {
  process.env.HOME = personsHome;
  if (personsTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = personsTmpdir;
  rmSync(this.home, { recursive: true, force: true });
});

// The smoke run uses the lab's real login, under the person's home: it checks that their Pi directory stays as it was.
Before({ tags: "@smoke" }, function (this: Context) {
  this.home = homedir();
  // The smoke run's log is looked at by its steps, not kept: experiments' results live outside this repository (D-07).
  this.logDirectory = mkdtempSync(join(tmpdir(), "agents-lab-smoke-logs-"));
  this.personsPiFiles = filesUnder(personsPiDirectory(this));
});

After({ tags: "@smoke" }, function (this: Context) {
  rmSync(this.logDirectory, { recursive: true, force: true });
});
