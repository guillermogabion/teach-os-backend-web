import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "@/middleware/auth";
import { requireRole } from "@/middleware/rbac";
import {
    activateLicenseHandler,
    validateLicenseHandler,
    createLicenseHandler,
    listLicensesHandler,
    revokeLicenseHandler,
    listLicenseDevicesHandler,
    revokeLicenseDeviceHandler,
} from "@/controllers/license.controller";

const router = Router();

// Rate limit activation/validation attempts to slow down key-guessing.
const activateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
});
// Validation is called on every app startup, so it needs a much higher
// ceiling than activation — this is just to stop outright abuse, not to
// throttle normal use.
const validateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 200,
    standardHeaders: true,
    legacyHeaders: false,
});

// Public: called by the TeacherOS mobile app, not the admin panel —
// no admin session exists on a phone activating a fresh install.
router.post("/activate", activateLimiter, activateLicenseHandler);
router.post("/validate", validateLimiter, validateLicenseHandler);

// Everything below is admin-only license management.
router.use(requireAuth);
router.get("/", requireRole("ADMIN", "SUPER_ADMIN"), listLicensesHandler);
router.post("/", requireRole("ADMIN", "SUPER_ADMIN"), createLicenseHandler);
router.post("/:id/revoke", requireRole("ADMIN", "SUPER_ADMIN"), revokeLicenseHandler);
router.get("/:id/devices", requireRole("ADMIN", "SUPER_ADMIN"), listLicenseDevicesHandler);
router.post(
    "/:id/devices/:deviceId/revoke",
    requireRole("ADMIN", "SUPER_ADMIN"),
    revokeLicenseDeviceHandler
);

export default router;