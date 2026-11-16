import type { Context } from "./context.ts";

/**
 * The readers of "the configuration is changed so that …" besides the congress's, one per library scenario whose
 * contract uses those words: the first that applies to the scenario set up reads the change.
 */
export const configurationChanges: { applies: (context: Context) => boolean; read: (context: Context, change: string) => void }[] = [];
