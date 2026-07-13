import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const roleNames = ["SUPER_ADMIN", "ADMIN", "SUPPORT"] as const;
  const roles: Record<string, { id: string }> = {};

  for (const name of roleNames) {
    roles[name] = await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  const superAdminEmail = "superadmin@teachos.dev";
  const passwordHash = await bcrypt.hash("ChangeMe123!", 12);

  await prisma.user.upsert({
    where: { email: superAdminEmail },
    update: {},
    create: {
      email: superAdminEmail,
      passwordHash,
      name: "Super Admin",
      roleId: roles.SUPER_ADMIN.id,
    },
  });

  const freePlan = await prisma.subscriptionPlan.upsert({
    where: { id: "seed-free-plan" },
    update: {},
    create: {
      id: "seed-free-plan",
      name: "Free",
      description: "Default free tier",
      price: 0,
      billingCycle: "MONTHLY",
      maxStorageMb: 100,
      maxQuizzes: 5,
      maxLessonPlans: 5,
    },
  });

  const premiumPlan = await prisma.subscriptionPlan.upsert({
    where: { id: "seed-premium-monthly" },
    update: {},
    create: {
      id: "seed-premium-monthly",
      name: "Premium Monthly",
      description: "Full feature access, billed monthly",
      price: 299,
      billingCycle: "MONTHLY",
      maxStorageMb: 5000,
      maxQuizzes: 500,
      maxLessonPlans: 500,
    },
  });

  const featureFlags: Array<[string, string, boolean]> = [
    [freePlan.id, "ocr", false],
    [freePlan.id, "ai_lesson_planner", false],
    [freePlan.id, "pdf_export", true],
    [premiumPlan.id, "ocr", true],
    [premiumPlan.id, "ai_lesson_planner", true],
    [premiumPlan.id, "pdf_export", true],
    [premiumPlan.id, "ai_tutor", true],
  ];

  for (const [planId, featureKey, enabled] of featureFlags) {
    await prisma.featurePermission.upsert({
      where: { planId_featureKey: { planId, featureKey } },
      update: { enabled },
      create: { planId, featureKey, enabled },
    });
  }

  console.log("Seed complete.");
  console.log(`Super admin login: ${superAdminEmail} / ChangeMe123!`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());