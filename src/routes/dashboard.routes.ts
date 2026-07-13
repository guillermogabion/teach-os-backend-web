import { Router } from "express";
import { requireAuth } from "@/middleware/auth";
import { getOverview } from "@/controllers/dashboard.controller";

const router = Router();

router.use(requireAuth);
router.get("/overview", getOverview);

export default router;
