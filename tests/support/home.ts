import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";

// A run opens Pi sessions under the home directory (~/.agents-lab/pi/), and Pi falls back to ~/.pi/agent/: each test
// gets a home of its own, so no test reads or writes the person's.
let home: string;
const personsHome = process.env.HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agents-lab-home-"));
  process.env.HOME = home;
});

afterEach(() => {
  process.env.HOME = personsHome;
  rmSync(home, { recursive: true, force: true });
});
