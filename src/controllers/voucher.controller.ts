import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@/config/prisma";
import { asyncHandler } from "@/middleware/errorHandler";
import * as voucherService from "@/services/voucher.service";

function logAction(req: Request, action: string, entityId: string, meta?: unknown) {
    return prisma.auditLog.create({
        data: {
            userId: req.user?.sub,
            action,
            entity: "VoucherCode",
            entityId,
            ip: req.ip,
            userAgent: req.headers["user-agent"],
            meta: meta ? JSON.stringify(meta) : undefined,
        },
    });
}

const discountTypeEnum = z.enum(["PERCENTAGE", "FIXED"]);

const createSchema = z.object({
    code: z.string().min(3).max(40),
    name: z.string().min(1),
    description: z.string().optional(),
    discountType: discountTypeEnum,
    discountAmount: z.coerce.number().min(0).optional(),
    bonusDays: z.coerce.number().int().min(0).optional(),
    maxUsage: z.coerce.number().int().min(0).optional(),
    expiresAt: z.coerce.date().optional(),
    isActive: z.boolean().optional(),
    firstTimeOnly: z.boolean().optional(),
    premiumOnly: z.boolean().optional(),
    eligiblePlanIds: z.array(z.string()).optional(),
    campaignId: z.string().optional(),
});

export const createVoucherHandler = asyncHandler(async (req: Request, res: Response) => {
    const input = createSchema.parse(req.body);
    const voucher = await voucherService.createVoucher(input);
    await logAction(req, "VOUCHER_CREATED", voucher.id, input);
    res.status(201).json(voucher);
});

const updateSchema = createSchema.partial();

export const updateVoucherHandler = asyncHandler(async (req: Request, res: Response) => {
    const input = updateSchema.parse(req.body);
    const voucher = await voucherService.updateVoucher(req.params.id, input);
    await logAction(req, "VOUCHER_UPDATED", voucher.id, input);
    res.json(voucher);
});

export const toggleVoucherHandler = asyncHandler(async (req: Request, res: Response) => {
    const voucher = await voucherService.toggleVoucherActive(req.params.id);
    await logAction(req, "VOUCHER_TOGGLED", voucher.id, { isActive: voucher.isActive });
    res.json(voucher);
});

export const deleteVoucherHandler = asyncHandler(async (req: Request, res: Response) => {
    await voucherService.deleteVoucher(req.params.id);
    await logAction(req, "VOUCHER_DELETED", req.params.id);
    res.status(204).send();
});

const listQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().optional(),
    campaignId: z.string().optional(),
    isActive: z.coerce.boolean().optional(),
});

export const listVouchersHandler = asyncHandler(async (req: Request, res: Response) => {
    const query = listQuerySchema.parse(req.query);
    res.json(await voucherService.listVouchers(query));
});

export const getVoucherHandler = asyncHandler(async (req: Request, res: Response) => {
    res.json(await voucherService.getVoucher(req.params.id));
});

// ---------- Public: buyer-facing "apply code" preview ----------

const validateSchema = z.object({
    code: z.string().min(1),
    planId: z.string().min(1),
    amount: z.coerce.number().min(0),
    buyerEmail: z.string().email().optional(),
});

export const validateVoucherHandler = asyncHandler(async (req: Request, res: Response) => {
    const input = validateSchema.parse(req.body);
    const effect = await voucherService.validateVoucher(input);
    res.json(effect);
});