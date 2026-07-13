import { Router } from "express";
import { requireAuth } from "@/middleware/auth";
import { requireRole } from "@/middleware/rbac";
import { listPlans } from "@/controllers/plans.controller";

const router = Router();

router.use(requireAuth);
router.get("/", requireRole("ADMIN", "SUPER_ADMIN"), listPlans);

export default router;
