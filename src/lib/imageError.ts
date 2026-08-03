/**
 * The one error type the image pipeline throws, in a module of its own so both
 * backends can throw it without an import cycle (`images.ts` dispatches into
 * `comfyui.ts`, and `comfyui.ts` would otherwise have to import back).
 *
 * `status`/`retryable` mirror `OpenRouterError`: the OpenRouter image path
 * decides retryability inline from `res.status` and never reads them, but the
 * ComfyUI path is a queue-then-poll flow that fails at three separate points,
 * so it needs the decision carried on the error instead.
 */
export class ImageError extends Error {
  /** HTTP status when the failure came from a response, else undefined. */
  status?: number;
  /** Whether re-issuing the same request could plausibly succeed. */
  retryable: boolean;

  constructor(message: string, opts: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = "ImageError";
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
  }
}
