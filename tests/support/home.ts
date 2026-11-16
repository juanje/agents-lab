import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";

// A run opens Pi sessions under the home directory (~/.agents-lab/pi/), and Pi falls back to ~/.pi/agent/: each test
// gets a home of its own, so no test reads or writes the person's. The home is the test's temporary directory too
// (os.tmpdir() reads TMPDIR), so whatever the test makes there is removed with it.
let home: string;
const personsHome = process.env.HOME;
const personsTmpdir = process.env.TMPDIR;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agents-lab-home-"));
  process.env.HOME = home;
  process.env.TMPDIR = home;
});

afterEach(() => {
  process.env.HOME = personsHome;
  if (personsTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = personsTmpdir;
  rmSync(home, { recursive: true, force: true });
});
