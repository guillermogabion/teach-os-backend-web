import { Request, Response, NextFunction } from "express";

/**
 * Restricts a route to one or more roles, e.g.
 *   router.delete("/:id", requireAuth, requireRole("SUPER_ADMIN"), handler)
 *
 * Must run after requireAuth so req.user is populated.
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient role permissions" });
    }
    next();
  };
}
