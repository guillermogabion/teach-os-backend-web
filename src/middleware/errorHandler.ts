import { Request, Response, NextFunction } from "express";
import { sendBuyerConflictEmail } from "@/services/mailer.service";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Wraps async route handlers so thrown/rejected errors reach errorHandler
// instead of crashing the process or hanging the request.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  let status = 500;
  let message = "Internal server error";

  // 1. Determine the status and error message
  if (err instanceof ApiError) {
    status = err.status;
    message = err.message;
  } else if (typeof err === "object" && err !== null && (err as any).code === "P2002") {
    status = 409;
    message = "This record already exists.";
  } else {
    console.error(err);
  }

  // 2. If it is a 409, attempt to email the buyer
  if (status === 409) {
    // Extract the email depending on how it was sent in the request
    const targetEmail = req.body?.buyerEmail || req.body?.email;

    if (targetEmail && typeof targetEmail === "string") {
      sendBuyerConflictEmail(targetEmail, message).catch((mailErr) => {
        console.error("❌ Failed to send 409 notification to buyer:", mailErr.message);
      });
    } else {
      console.warn("⚠️ 409 Error occurred, but no buyer email was found in req.body to notify.");
    }
  }

  // 3. Send the response to the client
  return res.status(status).json({ error: message });
}

