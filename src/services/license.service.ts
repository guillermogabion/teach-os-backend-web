// license.service.ts — only the changed function + its callers' messages

import crypto from "crypto";
import { prisma } from "@/config/prisma";
import { ApiError } from "@/middleware/errorHandler";

// Prisma client may not have strongly-typed property for the LicenseDevice
// model in some build setups; use an any-typed alias for device ops.
const p = prisma as any;

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
 * Registers (or checks back in) a device against a license, enforcing
 * maxDevices. deviceId is a stable UUID the client app generates once
 * on first launch and keeps in secure/local storage — it is NOT derived
 * or verified server-side, so it's only as trustworthy as the app
 * sending it. A tampered/rebuilt client could send a fake or randomized
 * deviceId to slip past this. What this DOES reliably stop: casual
 * key-sharing (the common case) and gives admins a real, named device
 * to revoke — it is not a substitute for real attestation (see note
 * at the bottom of this file for what that would take).
 */
async function registerDevice(
    licenseId: string,
    maxDevices: number,
    deviceId: string,
    deviceName?: string | null
) {
    const existing = await p.licenseDevice.findUnique({
        where: { licenseId_deviceId: { licenseId, deviceId } },
    });

    if (existing) {
        if (existing.revoked) {
            throw new ApiError(
                403,
                "This device has been revoked for this license. Contact support to restore access."
            );
        }
        return p.licenseDevice.update({
            where: { id: existing.id },
            data: { lastSeenAt: new Date(), ...(deviceName ? { deviceName } : {}) },
        });
    }

    const activeDeviceCount = await p.licenseDevice.count({
        where: { licenseId, revoked: false },
    });
    if (activeDeviceCount >= maxDevices) {
        throw new ApiError(
            403,
            `This license is already active on its maximum number of devices (${maxDevices}). Remove/revoke a device first, or contact support.`
        );
    }

    return p.licenseDevice.create({
        data: { licenseId, deviceId, deviceName: deviceName ?? undefined },
    });
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
    deviceId: string;
    deviceName?: string;
}

export async function activateLicense({
    licenseKey,
    email,
    deviceId,
    deviceName,
}: ActivateLicenseParams) {
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
        if (license.email !== normalizedEmail) {
            throw new ApiError(409, "This license key is already activated to a different account");
        }
        // Same email calling again: this is how a second/third device (up
        // to maxDevices) gets added — a new phone or tablet, not a brand
        // new activation. Rejected inside registerDevice if already at
        // the device limit.
        await registerDevice(license.id, license.maxDevices, deviceId, deviceName);
        const refreshed = await prisma.license.findUnique({
            where: { id: license.id },
            include: { plan: true, devices: true },
        });
        if (!refreshed) throw new ApiError(404, "License not found");
        return refreshed;
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

    await registerDevice(license.id, license.maxDevices, deviceId, deviceName);

    return prisma.license.update({
        where: { id: license.id },
        data: {
            email: normalizedEmail,
            status: "ACTIVATED",
            activatedAt: new Date(),
        },
        include: { plan: true, devices: true },
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

export async function listLicenseDevices(licenseId: string) {
    const license = await prisma.license.findUnique({ where: { id: licenseId } });
    if (!license) throw new ApiError(404, "License not found");

    return p.licenseDevice.findMany({
        where: { licenseId },
        orderBy: { lastSeenAt: "desc" },
    });
}

/**
 * Remote-revokes one specific device from a license without touching
 * the others or the license itself — e.g. a lost/stolen phone. The
 * device's row stays (for audit history) but `revoked: true` blocks it
 * from passing validateLicenseStatus and frees up its device slot.
 */
export async function revokeLicenseDevice(licenseId: string, deviceRowId: string) {
    const device = await p.licenseDevice.findUnique({ where: { id: deviceRowId } });
    if (!device || device.licenseId !== licenseId) {
        throw new ApiError(404, "Device not found for this license");
    }

    return p.licenseDevice.update({
        where: { id: deviceRowId },
        data: { revoked: true },
    });
}

interface ListLicensesParams {
    page: number;
    pageSize: number;
}

export async function listLicenses({ page, pageSize }: ListLicensesParams) {
    const [items, total] = await Promise.all([
        prisma.license.findMany({
            include: { plan: true, devices: true },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.license.count(),
    ]);
    return { items, total, page, pageSize };
}

/**
 * Bulk-marks any license whose expiresAt has passed as EXPIRED, even if
 * nobody has activated or validated that specific license since it
 * lapsed. Without this, a license just sitting untouched past its
 * expiry keeps reporting ACTIVATED/UNUSED everywhere except the two
 * one-off checks inside activateLicense/validateLicenseStatus, which
 * only ever catch it the next time THAT license happens to be used.
 *
 * Only touches ACTIVATED/UNUSED rows with a real (non-null) expiresAt
 * in the past. Lifetime licenses (expiresAt: null, e.g. ONE_TIME plans)
 * and rows already REVOKED/EXPIRED are left untouched.
 *
 * Meant to be called on a schedule (see the cron/interval note where
 * this is wired up) and/or manually via the admin expire-check route.
 */
export async function checkAndExpireLicenses() {
    return prisma.license.updateMany({
        where: {
            status: { in: ["ACTIVATED", "UNUSED"] },
            expiresAt: { lt: new Date() },
        },
        data: { status: "EXPIRED" },
    });
}

interface ValidateLicenseParams {
    licenseKey: string;
    email: string;
    deviceId: string;
}

/**
 * Checks if a previously activated license key is still valid and not
 * expired. Meant to be called by the client app on startup.
 *
 * deviceId is required and checked against registered devices for this
 * license — a valid key + email is no longer enough on its own. If this
 * exact device was never activated (or was later revoked by an admin),
 * validation fails and the app should send the user back through
 * activation instead of silently trusting a copied key+email pair.
 */
export async function validateLicenseStatus({ licenseKey, email, deviceId }: ValidateLicenseParams) {
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

    const device = await p.licenseDevice.findUnique({
        where: { licenseId_deviceId: { licenseId: license.id, deviceId } },
    });

    if (!device || device.revoked) {
        throw new ApiError(
            403,
            "This device is not registered for this license. Please activate the license on this device first."
        );
    }

    await p.licenseDevice.update({
        where: { id: device.id },
        data: { lastSeenAt: new Date() },
    });

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