import { setDefaultTimeout } from "@cucumber/cucumber";

// Loaded only by the smoke profile: a real model takes seconds per turn, and the run makes several activations.
setDefaultTimeout(5 * 60_000);
