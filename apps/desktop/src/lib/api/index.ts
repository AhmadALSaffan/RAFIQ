/**
 * Barrel for the API layer, so callers keep importing from `lib/api`.
 * Add new endpoints to the module that owns them, never to this file.
 */

export * from "./client";
export * from "./models";
export * from "./accounts";
export * from "./tasks";
export * from "./attachments";
export * from "./chats";
export * from "./integrations";
export * from "./files";
export * from "./settings";
export * from "./skills";
export * from "./designs";
export * from "./automation";
export * from "./insights";
export * from "./memory";
export * from "./workspaces";
export * from "./backup";
