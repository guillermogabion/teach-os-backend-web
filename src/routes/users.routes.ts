import { Router } from "express";
import { requireAuth } from "@/middleware/auth";
import { requireRole } from "@/middleware/rbac";
import {
  listUsers,
  getUser,
  suspendUser,
  unsuspendUser,
  deleteUser,
  listRoles,
  createUser
} from "@/controllers/users.controller";

const router = Router();

router.use(requireAuth);

router.get("/", listUsers);

// 1. SPECIFIC routes must go ABOVE dynamic routes
router.get("/roles", listRoles);

// 2. DYNAMIC routes go below
router.get("/:id", getUser);
router.post("/", requireRole("ADMIN", "SUPER_ADMIN"), createUser);
// 3. Changed POST to PATCH to match the frontend api.patch() calls
// Suspend/unsuspend: Admin and Super Admin
router.patch("/:id/suspend", requireRole("ADMIN", "SUPER_ADMIN"), suspendUser);
router.patch("/:id/unsuspend", requireRole("ADMIN", "SUPER_ADMIN"), unsuspendUser);

// Delete: Super Admin only, per spec ("Admin cannot delete users")
router.delete("/:id", requireRole("SUPER_ADMIN"), deleteUser);

export default router;