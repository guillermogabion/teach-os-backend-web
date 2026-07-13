import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@/config/prisma";
import { asyncHandler } from "@/middleware/errorHandler";
import * as paymentsService from "@/services/payment.service";

function logAction(req: Request, action: string, entityId: string, meta?: unknown) {
    return prisma.auditLog.create({
        data: {
            userId: req.user?.sub,
            action,
            entity: "Payment",
            entityId,
            ip: req.ip,
            userAgent: req.headers["user-agent"],
            meta: meta ? JSON.stringify(meta) : undefined,
        },
    });
}

const createSchema = z.object({
    planId: z.string().min(1),
    amount: z.coerce.number().min(0),
    provider: z.enum(["GCASH", "PAYMONGO", "STRIPE", "MAYA"]),
    currency: z.string().optional(),
    receiptUrl: z.string().url().optional(),
    buyerEmail: z.string().email().optional(),
    buyerName: z.string().optional(),
    voucherCode: z.string().optional(),
});

export const createPaymentHandler = asyncHandler(async (req: Request, res: Response) => {
    const input = createSchema.parse(req.body);
    const result = await paymentsService.createPayment(input);
    // NOTE: this used to read result.id and result.subscriptionId, but
    // createPayment returns { payment, license } — neither field exists
    // on that shape, so every audit log entry here was recording
    // `undefined`. Fixed to read the actual nested fields.
    await logAction(req, "PAYMENT_CREATED", result.payment.id, {
        ...input,
        licenseId: result.license.id,
    });
    res.status(201).json(result);
});

const listQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(["PENDING", "PAID", "EXPIRED", "FAILED", "REFUNDED"]).optional(),
});

export const listPaymentsHandler = asyncHandler(async (req: Request, res: Response) => {
    const query = listQuerySchema.parse(req.query);
    res.json(await paymentsService.listPayments(query));
});

export const getPaymentHandler = asyncHandler(async (req: Request, res: Response) => {
    res.json(await paymentsService.getPayment(req.params.id));
});

export const approvePaymentHandler = asyncHandler(async (req: Request, res: Response) => {
    const result = await paymentsService.approvePayment(req.params.id);
    await logAction(req, "PAYMENT_APPROVED", req.params.id, { licenseId: result.license.id });
    res.json(result);
});

export const rejectPaymentHandler = asyncHandler(async (req: Request, res: Response) => {
    const payment = await paymentsService.rejectPayment(req.params.id);
    await logAction(req, "PAYMENT_REJECTED", payment.id);
    res.json(payment);
});

export const refundPaymentHandler = asyncHandler(async (req: Request, res: Response) => {
    const payment = await paymentsService.refundPayment(req.params.id);
    await logAction(req, "PAYMENT_REFUNDED", payment.id);
    res.json(payment);
});