/**
 * Shared HTTP scraps. Small on purpose — every request in the app is a hand-
 * written `fetch`, and this only holds what more than one of them needs.
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * The human-readable reason out of a failed response, never throwing on the way.
 * Prefers a JSON `error.message` (what OpenRouter and ComfyUI both send), falls
 * back to the raw body, truncated — an error line is for the player, and a
 * 4KB HTML error page pasted under a portrait helps nobody.
 *
 * Returns "" when even reading the body fails, so callers can treat the detail
 * as optional and still produce a message.
 */
export async function safeErrorText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const json: unknown = JSON.parse(text);
      if (isRecord(json) && isRecord(json.error) && typeof json.error.message === "string") {
        return json.error.message;
      }
      return text.slice(0, 200);
    } catch {
      return text.slice(0, 200);
    }
  } catch {
    return "";
  }
}
