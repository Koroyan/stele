/** API errors with stable machine-readable codes. Internal details never reach clients. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (code: string, message: string, details?: Record<string, unknown>) =>
  new ApiError(400, code, message, details);
export const unauthorized = (message = "Authentication required") =>
  new ApiError(401, "unauthorized", message);
export const forbidden = (message = "You do not have access to this resource") =>
  new ApiError(403, "forbidden", message);
export const notFound = (what = "Resource") => new ApiError(404, "not_found", `${what} not found`);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
export const unavailable = (code: string, message: string) => new ApiError(503, code, message);
