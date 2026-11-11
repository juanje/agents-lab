#!/usr/bin/env node
// The `lab` command as the package installs it (its "bin" entry; `npm link` puts it on the PATH). It registers tsx
// from this package, found from this file wherever the command runs, then runs the TypeScript entry point.
import { register } from "tsx/esm/api";

register();
await import("./main.ts");
