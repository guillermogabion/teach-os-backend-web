import { Request, Response } from "express";
import { prisma } from "@/config/prisma";
import { asyncHandler } from "@/middleware/errorHandler";

export const listPlans = asyncHandler(async (_req: Request, res: Response) => {
    const plans = await prisma.subscriptionPlan.findMany({
        where: {
            isActive: true,
            isArchived: false,
        },
        select: {
            id: true,
            name: true,
            price: true,
            billingCycle: true,
            description: true,
        },
        orderBy: [{ price: "asc" }, { name: "asc" }],
    });

    res.json(plans);
});
