import { Router } from "express";
import { requireAuth } from "@/middleware/auth";
import { requireRole } from "@/middleware/rbac";
import {
    createCampaignHandler,
    updateCampaignHandler,
    listCampaignsHandler,
    getCampaignHandler,
    deleteCampaignHandler,
} from "@/controllers/campaign.controller";

const router = Router();

// All admin-only — campaigns are an internal grouping/reporting concept,
// nothing here is called by the buyer-facing app.
router.use(requireAuth, requireRole("ADMIN", "SUPER_ADMIN"));

router.get("/", listCampaignsHandler);
router.post("/", createCampaignHandler);
router.get("/:id", getCampaignHandler);
router.patch("/:id", updateCampaignHandler);
router.delete("/:id", deleteCampaignHandler);

export default router;