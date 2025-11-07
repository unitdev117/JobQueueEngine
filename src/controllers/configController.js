// This feature used to edit config.json, but we removed that file.
// Keeping the command but it just tells you to use .env or CLI flags now.
import { logJson } from "../utils/logger.js";

export function configSetController(key, value) {
  try {
    logJson({
      at: new Date().toISOString(),
      type: "command",
      cmd: "config_set",
      key,
      value,
    });
  } catch {}
  return { message: "Use .env or CLI flags to configure now." };
}
