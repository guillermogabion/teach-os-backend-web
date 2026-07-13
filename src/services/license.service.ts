// license.service.ts — only the changed function + its callers' messages

import crypto from "crypto";
import { prisma } from "@/config/prisma";
import { ApiError } from "@/middleware/errorHandler";

function generateLicenseKey(): string {
    const groups = Array.from({ length: 3 }, () =>
        crypto.randomBytes(2).toString("hex").toUpperCase()
    );
    return `TEAC-${groups.join("-")}`;
}

function normalizeEmail(email?: string | null): string | null {
    return email ? email.trim().toLowerCase() : null;
}

/**
 * Enforces "one active license per email": true if this email currently
 * holds a still-live license that hasn't expired — either ACTIVATED, or
 * UNUSED but already issued/pre-assigned to this email (paid for, key
 * emailed, but not yet activated in the app). UNUSED has to count here
 * too, otherwise the same email can buy a second key while the first
 * one they already paid for is just sitting unclaimed.
 *
 * excludeLicenseId lets a check skip the license currently being
 * evaluated, so re-activating/re-issuing your own still-live key doesn't
 * trip its own guard.
 */
export async function hasActiveLicenseForEmail(
    email: string,
    excludeLicenseId?: string
): Promise<boolean> {
    const existing = await prisma.license.findFirst({
        where: {
            email: normalizeEmail(email),
            status: { in: ["ACTIVATED", "UNUSED"] },
            ...(excludeLicenseId ? { id: { not: excludeLicenseId } } : {}),
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
    });
    return !!existing;
}

interface CreateLicenseParams {
    planId: string;
    maxDevices?: number;
    expiresInDays?: number;
    email?: string | null;
}

export async function createLicense({ planId, maxDevices, expiresInDays, email }: CreateLicenseParams) {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new ApiError(404, "Plan not found");

    const normalizedEmail = normalizeEmail(email);

    if (normalizedEmail && (await hasActiveLicenseForEmail(normalizedEmail))) {
        throw new ApiError(
            409,
            "This email already has an active or pending license. A new key cannot be issued until the current one is activated-and-expires, or is revoked."
        );
    }

    const expiresAt = expiresInDays
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
        : null;

    return prisma.license.create({
        data: {
            key: generateLicenseKey(),
            planId,
            email: normalizedEmail,
            maxDevices: maxDevices ?? 1,
            expiresAt,
        },
    });
}

interface ActivateLicenseParams {
    licenseKey: string;
    email: string;
}

export async function activateLicense({ licenseKey, email }: ActivateLicenseParams) {
    const normalizedEmail = normalizeEmail(email)!;

    const license = await prisma.license.findUnique({
        where: { key: licenseKey },
        include: { plan: true },
    });

    if (!license) {
        throw new ApiError(404, "License key not found");
    }

    if (license.status === "REVOKED") {
        throw new ApiError(403, "This license key has been revoked");
    }

    const isExpiredByDate = license.expiresAt !== null && license.expiresAt < new Date();
    if (license.status === "EXPIRED" || isExpiredByDate) {
        if (license.status !== "EXPIRED") {
            await prisma.license.update({ where: { id: license.id }, data: { status: "EXPIRED" } });
        }
        throw new ApiError(400, "This license key has expired");
    }

    if (license.status === "ACTIVATED") {
        throw new ApiError(
            409,
            "This license key has already been activated and cannot be used again."
        );
    }

    if (license.email && license.email !== normalizedEmail) {
        throw new ApiError(
            403,
            "This license key was issued to a different email address and cannot be activated with this one"
        );
    }

    if (await hasActiveLicenseForEmail(normalizedEmail, license.id)) {
        throw new ApiError(
            409,
            "This email already has an active or pending license. Only one is allowed per account — wait for it to expire, activate it, or contact support to have it revoked first."
        );
    }

    return prisma.license.update({
        where: { id: license.id },
        data: {
            email: normalizedEmail,
            status: "ACTIVATED",
            activatedAt: new Date(),
        },
        include: { plan: true },
    });
}

export async function revokeLicense(id: string) {
    const license = await prisma.license.findUnique({ where: { id } });
    if (!license) throw new ApiError(404, "License not found");

    return prisma.license.update({
        where: { id },
        data: { status: "REVOKED" },
    });
}

interface ListLicensesParams {
    page: number;
    pageSize: number;
}

export async function listLicenses({ page, pageSize }: ListLicensesParams) {
    const [items, total] = await Promise.all([
        prisma.license.findMany({
            include: { plan: true },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.license.count(),
    ]);
    return { items, total, page, pageSize };
}

interface ValidateLicenseParams {
    licenseKey: string;
    email: string;
}

/**
 * Checks if a previously activated license key is still valid and not expired.
 * This is meant to be called by the client app on startup.
 */
export async function validateLicenseStatus({ licenseKey, email }: ValidateLicenseParams) {
    const normalizedEmail = normalizeEmail(email)!;

    const license = await prisma.license.findUnique({
        where: { key: licenseKey },
        include: { plan: true },
    });

    if (!license) {
        throw new ApiError(404, "License key not found");
    }

    if (license.email !== normalizedEmail) {
        throw new ApiError(403, "This license key is registered to a different email address");
    }

    if (license.status === "REVOKED") {
        throw new ApiError(403, "This license key has been revoked");
    }

    // Check if expired
    const isExpiredByDate = license.expiresAt !== null && license.expiresAt < new Date();
    if (license.status === "EXPIRED" || isExpiredByDate) {
        // Auto-update database status if it naturally expired by date
        if (license.status !== "EXPIRED") {
            await prisma.license.update({ where: { id: license.id }, data: { status: "EXPIRED" } });
        }
        throw new ApiError(400, "This license key has expired");
    }

    if (license.status !== "ACTIVATED") {
        throw new ApiError(400, "This license key has not been activated yet");
    }

    // If it passes all checks, it is valid and active.
    return {
        isValid: true,
        status: license.status,
        plan: license.plan,
        maxDevices: license.maxDevices,
        activatedAt: license.activatedAt,
        expiresAt: license.expiresAt,
    };
}