import { Router } from "express";
import authRoutes from "@/routes/auth.routes";
import usersRoutes from "@/routes/users.routes";
import settingsRoute from "@/routes/settings.routes";
import dashboardRoutes from "@/routes/dashboard.routes";
import licenseRoutes from "@/routes/license.routes";
import paymentsRoutes from "@/routes/payments.routes";
import vouchersRoutes from "@/routes/voucher.routes";
import campaignRoutes from "@/routes/campaign.routes";
import plansRoutes from "@/routes/plans.routes";

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

// Additional modules from the spec (teachers, subscriptions, plans,
// payments, vouchers, promos, reports, settings, logs) follow the same
// pattern as users.routes.ts / users.controller.ts above — add a
// controller + router pair and mount it here.

export default router;
