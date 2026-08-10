import { Router } from "express";

import authRoutes from "./auth.routes";
import usersRoutes from "./users.routes";
import settingsRoute from "./settings.routes";
import dashboardRoutes from "./dashboard.routes";
import licenseRoutes from "./license.routes";
import paymentsRoutes from "./payments.routes";
import vouchersRoutes from "./voucher.routes";
import campaignRoutes from "./campaign.routes";
import plansRoutes from "./plans.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/users", usersRoutes);
router.use("/settings", settingsRoute);
router.use("/dashboard", dashboardRoutes);
router.use("/licenses", licenseRoutes);
router.use("/payments", paymentsRoutes);
router.use("/vouchers", vouchersRoutes);
router.use("/promo-campaigns", campaignRoutes);
router.use("/plans", plansRoutes);

export default router;