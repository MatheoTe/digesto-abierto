import { unstable_rethrow } from "next/navigation";
import { toErrorResponse } from "../errors";

/**
 * Wrap a route handler so that any thrown AppError (or unexpected error)
 * becomes a consistent JSON error response instead of a framework 500 page.
 * Next.js control-flow errors (prerender bail-outs, redirects) are rethrown.
 */
export function withErrors<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      unstable_rethrow(err);
      return toErrorResponse(err);
    }
  };
}
