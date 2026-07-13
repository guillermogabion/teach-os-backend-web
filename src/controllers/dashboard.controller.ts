import { Request, Response } from "express";
import { prisma } from "@/config/prisma";
import { asyncHandler } from "@/middleware/errorHandler";

export const getOverview = asyncHandler(async (_req: Request, res: Response) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [
    totalUsers,
    activeTeachers,
    premiumSubs,
    trialSubs,
    newUsersToday,
    paidPayments,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.teacherProfile.count(),
    prisma.subscription.count({ where: { status: "ACTIVE" } }),
    prisma.subscription.count({ where: { status: "TRIAL" } }),
    prisma.user.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.payment.findMany({ where: { status: "PAID" } }),
  ]);

  const totalRevenue = paidPayments.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0);

  res.json({
    totalUsers,
    activeTeachers,
    premiumSubs,
    trialSubs,
    newUsersToday,
    totalRevenue,
  });
});
