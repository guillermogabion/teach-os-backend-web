import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@/config/prisma";
import { asyncHandler } from "@/middleware/errorHandler";
import * as campaignService from "@/services/campaign.service";

function logAction(req: Request, action: string, entityId: string, meta?: unknown) {
    return prisma.auditLog.create({
        data: {
            userId: req.user?.sub,
            action,
            entity: "PromoCampaign",
            entityId,
            ip: req.ip,
            userAgent: req.headers["user-agent"],
            meta: meta ? JSON.stringify(meta) : undefined,
        },
    });
}

const createSchema = z.object({
    name: z.string().min(1),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    bannerUrl: z.string().url().optional(),
    isActive: z.boolean().optional(),
});

export const createCampaignHandler = asyncHandler(async (req: Request, res: Response) => {
    const input = createSchema.parse(req.body);
    const campaign = await campaignService.createCampaign(input);
    await logAction(req, "CAMPAIGN_CREATED", campaign.id, input);
    res.status(201).json(campaign);
});

const updateSchema = createSchema.partial();

export const updateCampaignHandler = asyncHandler(async (req: Request, res: Response) => {
    const input = updateSchema.parse(req.body);
    const campaign = await campaignService.updateCampaign(req.params.id, input);
    await logAction(req, "CAMPAIGN_UPDATED", campaign.id, input);
    res.json(campaign);
});

export const listCampaignsHandler = asyncHandler(async (_req: Request, res: Response) => {
    res.json(await campaignService.listCampaigns());
});

export const getCampaignHandler = asyncHandler(async (req: Request, res: Response) => {
    res.json(await campaignService.getCampaign(req.params.id));
});

export const deleteCampaignHandler = asyncHandler(async (req: Request, res: Response) => {
    await campaignService.deleteCampaign(req.params.id);
    await logAction(req, "CAMPAIGN_DELETED", req.params.id);
    res.status(204).send();
});