import { Router } from "express";
import rateLimit from "express-rate-limit";
import { loginHandler, refreshHandler, logoutHandler, meHandler } from "@/controllers/auth.controller";
import { requireAuth } from "@/middleware/auth";

const router = Router();

// Tighter limit on login to slow down credential-stuffing attempts.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/login", loginLimiter, loginHandler);
router.post("/refresh", refreshHandler);
router.post("/logout", logoutHandler);
router.get("/me", requireAuth, meHandler);

export default router;
