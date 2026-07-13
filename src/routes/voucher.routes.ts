import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "@/middleware/auth";
import { requireRole } from "@/middleware/rbac";
import {
    createVoucherHandler,
    updateVoucherHandler,
    toggleVoucherHandler,
    deleteVoucherHandler,
    listVouchersHandler,
    getVoucherHandler,
    validateVoucherHandler,
} from "@/controllers/voucher.controller";

const router = Router();

// Rate-limited the same way license activation is — this is an
// unauthenticated endpoint the buyer's checkout form calls directly,
// so it needs the same guard against brute-forcing codes.
const validateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
});

// Public: the buyer-facing checkout form calls this to preview a
// discount before submitting payment. Doesn't record a redemption —
// see voucher.service.ts's validateVoucher() docstring.
router.post("/validate", validateLimiter, validateVoucherHandler);

// Everything else is admin-only voucher management.
router.use(requireAuth);
router.get("/", requireRole("ADMIN", "SUPER_ADMIN"), listVouchersHandler);
router.post("/", requireRole("ADMIN", "SUPER_ADMIN"), createVoucherHandler);
router.get("/:id", requireRole("ADMIN", "SUPER_ADMIN"), getVoucherHandler);
router.patch("/:id", requireRole("ADMIN", "SUPER_ADMIN"), updateVoucherHandler);
router.post("/:id/toggle", requireRole("ADMIN", "SUPER_ADMIN"), toggleVoucherHandler);
router.delete("/:id", requireRole("ADMIN", "SUPER_ADMIN"), deleteVoucherHandler);

export default router;