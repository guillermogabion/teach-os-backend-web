import { Router } from "express";
import { requireAuth } from "@/middleware/auth";
import { requireRole } from "@/middleware/rbac";
import {
    createPaymentHandler,
    listPaymentsHandler,
    getPaymentHandler,
    approvePaymentHandler,
    rejectPaymentHandler,
    refundPaymentHandler,
} from "@/controllers/payments.controller";

const router = Router();

// Public: the buyer's own app/website calls this directly to record a
// payment attempt (e.g. right after sending GCash). No account, no
// login — this stands in for a future gateway webhook, which would also
// be unauthenticated from our side (signature-verified instead of a
// user token). This route MUST stay above router.use(requireAuth) below.
router.post("/", createPaymentHandler);

// Everything past this point is an internal admin action: viewing
// payment records, and approving/rejecting/refunding them (approval
// also issues a license key — see payment.service.ts). All require
// staff login, since this is where the claimed payment actually gets
// trusted and turned into something real.
router.use(requireAuth);

router.get("/", listPaymentsHandler);
router.get("/:id", getPaymentHandler);

router.post("/:id/approve", requireRole("ADMIN", "SUPER_ADMIN"), approvePaymentHandler);
router.post("/:id/reject", requireRole("ADMIN", "SUPER_ADMIN"), rejectPaymentHandler);
router.post("/:id/refund", requireRole("ADMIN", "SUPER_ADMIN"), refundPaymentHandler);

export default router;