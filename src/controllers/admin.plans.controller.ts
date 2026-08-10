import { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { asyncHandler } from "../middleware/errorHandler";

// READ: Get all unarchived plans
export const getPlansHandler = asyncHandler(async (_req: Request, res: Response) => {
    const plans = await prisma.subscriptionPlan.findMany({
        where: { isArchived: false },
        orderBy: { createdAt: "desc" },
    });
    res.json(plans);
});

// CREATE: Add a new subscription plan
export const createPlanHandler = asyncHandler(async (req: Request, res: Response) => {
    const { name, description, price, billingCycle, maxStorageMb, maxQuizzes, maxLessonPlans, isActive } = req.body;
    const plan = await prisma.subscriptionPlan.create({
        data: {
            name,
            description,
            price: Number(price),
            billingCycle,
            maxStorageMb: Number(maxStorageMb),
            maxQuizzes: Number(maxQuizzes),
            maxLessonPlans: Number(maxLessonPlans),
            isActive: isActive ?? true,
        },
    });
    res.status(201).json(plan);
});

// UPDATE: Modify an existing subscription plan
export const updatePlanHandler = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, description, price, billingCycle, maxStorageMb, maxQuizzes, maxLessonPlans, isActive } = req.body;

    const plan = await prisma.subscriptionPlan.update({
        where: { id },
        data: {
            name,
            description,
            price: Number(price),
            billingCycle,
            maxStorageMb: Number(maxStorageMb),
            maxQuizzes: Number(maxQuizzes),
            maxLessonPlans: Number(maxLessonPlans),
            isActive,
        },
    });
    res.json(plan);
});

// DELETE: Archive a subscription plan (preserves historical relations like payments/subscriptions)
export const deletePlanHandler = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const plan = await prisma.subscriptionPlan.update({
        where: { id },
        data: { isArchived: true, isActive: false },
    });
    res.json({ message: "Plan archived successfully", plan });
});