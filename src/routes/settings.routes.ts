import { Router } from "express";
import { requireAuth } from "@/middleware/auth";
import { requireRole } from "@/middleware/rbac";
import {
  getAllSettingsHandler,
  getGroupSettingsHandler,
  updateGroupSettingsHandler,
  resetGroupSettingsHandler,
} from "@/controllers/settings.controller";

const router = Router();

router.use(requireAuth);

// Anyone with panel access can view current settings.
router.get("/", getAllSettingsHandler);
router.get("/:group", getGroupSettingsHandler);

// Per spec: Admin "Cannot Change System Settings" — only Super Admin may write.
router.put("/:group", requireRole("SUPER_ADMIN"), updateGroupSettingsHandler);
router.delete("/:group", requireRole("SUPER_ADMIN"), resetGroupSettingsHandler);

export default router;
