import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import {
    getPlansHandler,
    createPlanHandler,
    updatePlanHandler,
    deletePlanHandler,
} from "../controllers/admin.plans.controller";

const router = Router();

router.use(requireAuth);
// Restrict plan management to administrators (adjust role string to match your RBAC setup)
router.use(requireRole("SUPER_ADMIN"));

router.get("/", getPlansHandler);
router.post("/", createPlanHandler);
router.put("/:id", updatePlanHandler);
router.delete("/:id", deletePlanHandler);

export default router;