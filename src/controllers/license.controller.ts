import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@/config/prisma";
import { asyncHandler } from "@/middleware/errorHandler";
import * as licenseService from "@/services/license.service";

function logAction(req: Request, action: string, entityId: string, meta?: unknown) {
    return prisma.auditLog.create({
        data: {
            userId: req.user?.sub,
            action,
            entity: "License",
            entityId,
            ip: req.ip,
            userAgent: req.headers["user-agent"],
            meta: meta ? JSON.stringify(meta) : undefined,
        },
    });
}

// ---------- Public: called by the TeacherOS mobile app ----------

const activateSchema = z.object({
    licenseKey: z.string().min(1),
    email: z.string().email(),
});

export const activateLicenseHandler = asyncHandler(async (req: Request, res: Response) => {
    const { licenseKey, email } = activateSchema.parse(req.body);

    const license = await licenseService.activateLicense({ licenseKey, email });

    await logAction(req, "LICENSE_ACTIVATED", license.id, { email });

    res.json({
        status: license.status,
        email: license.email,
        plan: license.plan,
        maxDevices: license.maxDevices,
        activatedAt: license.activatedAt,
        expiresAt: license.expiresAt,
    });
});

export const validateLicenseHandler = asyncHandler(async (req: Request, res: Response) => {
    // We can reuse the activateSchema since we need the exact same two fields
    const { licenseKey, email } = activateSchema.parse(req.body);

    const validLicenseInfo = await licenseService.validateLicenseStatus({ licenseKey, email });

    // Optional: You can log this action, or omit it if it creates too much noise on app startup
    // await logAction(req, "LICENSE_CHECKED", licenseKey, { email });

    res.json(validLicenseInfo);
});

// ---------- Admin: generate / list / revoke ----------

const createSchema = z.object({
    planId: z.string().min(1),
    maxDevices: z.coerce.number().int().min(1).optional(),
    expiresInDays: z.coerce.number().int().min(1).optional(),
});

export const createLicenseHandler = asyncHandler(async (req: Request, res: Response) => {
    const input = createSchema.parse(req.body);
    const license = await licenseService.createLicense(input);
    await logAction(req, "LICENSE_CREATED", license.id, input);
    res.status(201).json(license);
});

const listQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const listLicensesHandler = asyncHandler(async (req: Request, res: Response) => {
    const { page, pageSize } = listQuerySchema.parse(req.query);
    res.json(await licenseService.listLicenses({ page, pageSize }));
});

export const revokeLicenseHandler = asyncHandler(async (req: Request, res: Response) => {
    const license = await licenseService.revokeLicense(req.params.id);
    await logAction(req, "LICENSE_REVOKED", license.id);
    res.json(license);
});

