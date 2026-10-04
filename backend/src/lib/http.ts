import type { NextFunction, Request, Response, RequestHandler } from "express";
import type { ZodTypeAny, output } from "zod";

/** An error that maps directly to an HTTP status + `{ error }` body. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Wraps an async route handler so a rejected promise reaches the Express
 * error handler (Express 4 does not do this on its own).
 */
export function ah<Req extends Request = Request>(
  fn: (req: Req, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req as Req, res, next).catch(next);
  };
}

/** Parses `data` with a zod schema or throws a 400 with the first issue. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
    throw new HttpError(400, `${path}${issue.message}`);
  }
  return result.data;
}

/** Final Express error handler: always `{ error: string }`. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  // Malformed JSON body from express.json()
  if (err && typeof err === "object" && (err as { type?: string }).type === "entity.parse.failed") {
    return res.status(400).json({ error: "Request body is not valid JSON" });
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}
