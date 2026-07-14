import { Request, Response, NextFunction } from "express";

/**
 * Gate for routes meant to be triggered by an external scheduler (a free
 * GitHub Actions cron, cron-job.org, etc.) rather than a logged-in admin —
 * there's no browser session to produce a JWT from in that case. Checks a
 * shared secret header instead of requireAuth/requireRole.
 *
 * Set CRON_SECRET in your environment (Render + wherever the scheduler
 * lives) to the same random value. Treat it like a password: don't commit
 * it, don't reuse it elsewhere.
 */
export function requireCronSecret(req: Request, res: Response, next: NextFunction) {
    const provided = req.headers["x-cron-secret"];
    if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
        return res.status(401).json({ error: "Invalid or missing cron secret" });
    }
    next();
}