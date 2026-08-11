
import crypto from "crypto";
import { prisma } from "../config/prisma";
import { ApiError } from "../middleware/errorHandler";

// Prisma client may not have strongly-typed property for the LicenseDevice
// model in some build setups; use an any-typed alias for device ops.
const p = prisma as any;

// ─── HELPER TO MASK LICENSE KEYS ─────────────────────────────────────────────
export function maskLicenseKey(key: string): string {
    if (!key) return "—";

    // If the key is grouped by hyphens (e.g. TEAC-XXXX-XXXX-1234)
    const parts = key.split("-");
    if (parts.length > 1) {
        return parts.map((part, index) =>
            // Keep the prefix ('TEAC') and the last segment visible
            (index === 0 || index === parts.length - 1) ? part : "*".repeat(part.length)
        ).join("-");
    }

    // Fallback for solid strings: show only the last 4 characters
    if (key.length <= 4) return "*".repeat(key.length);
    return "*".repeat(key.length - 4) + key.slice(-4);
}
// ─────────────────────────────────────────────────────────────────────────────

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

// Maps a plan's billingCycle to a number of calendar months to add.
// null means "no expiry" (e.g. a lifetime/one-time plan).
const BILLING_CYCLE_MONTHS: Record<string, number | null> = {
    MONTHLY: 1,
    QUARTERLY: 3,
    SEMI_ANNUAL: 6,
    SEMIANNUAL: 6,
    BIANNUAL: 6,
    ANNUAL: 12,
    YEARLY: 12,
    LIFETIME: null,
    ONE_TIME: null,
};

/**
 * Adds `months` calendar months to `from` (e.g. Jan 31 + 1 month -> Feb 28/29,
 * not Mar 3). Used so MONTHLY/QUARTERLY/ANNUAL expiry lines up with what a
 * human means by "a month/quarter/year from now" instead of a fixed day count.
 */
function addCalendarMonths(from: Date, months: number): Date {
    const result = new Date(from);
    const targetMonth = result.getMonth() + months;
    result.setMonth(targetMonth);
    // If setMonth overflowed (e.g. Jan 31 -> Mar 3 because Feb has no 31st),
    // roll back to the last day of the intended month instead.
    if (result.getMonth() !== ((targetMonth % 12) + 12) % 12) {
        result.setDate(0);
    }
    return result;
}

/**
 * Resolves how long a newly created license should last based on its plan's
 * billingCycle, e.g. MONTHLY -> +1 month, QUARTERLY -> +3 months. Unknown/
 * unmapped billingCycle values fall back to null (no auto-expiry) rather than
 * guessing, and get logged so they don't fail silently.
 */
function expiryFromBillingCycle(billingCycle: string, from: Date = new Date()): Date | null {
    const key = billingCycle.trim().toUpperCase();
    if (!(key in BILLING_CYCLE_MONTHS)) {
        console.warn(
            `[license] Unrecognized billingCycle "${billingCycle}" — no auto-expiry applied. ` +
            `Add it to BILLING_CYCLE_MONTHS in license.service.ts if this is a real plan cycle.`
        );
        return null;
    }
    const months = BILLING_CYCLE_MONTHS[key];
    return months === null ? null : addCalendarMonths(from, months);
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

    // The plan's billingCycle is authoritative whenever it maps to a real
    // cycle (MONTHLY -> 1 month, QUARTERLY -> 3 months, etc.) — a license
    // for a quarterly plan should expire in 3 months regardless of whatever
    // expiresInDays the caller/form happens to send. expiresInDays is only
    // used as a fallback for plans with no derivable cycle (LIFETIME/
    // ONE_TIME, or an unrecognized billingCycle string) — that's the one
    // case where a manual day count is the only way to set an expiry.
    const cycleExpiresAt = expiryFromBillingCycle(plan.billingCycle);
    const expiresAt =
        cycleExpiresAt !== null
            ? cycleExpiresAt
            : expiresInDays
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

    // Apply the masking function to the returned items
    const maskedItems = items.map((item) => ({
        ...item,
        key: maskLicenseKey(item.key)
    }));

    return { items: maskedItems, total, page, pageSize };
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

const PRIVATE_KEY_B64 = process.env.LICENSE_SIGNING_PRIVATE_KEY;

let privateKeyObject: crypto.KeyObject | null = null;
if (PRIVATE_KEY_B64) {
    try {
        const der = Buffer.from(PRIVATE_KEY_B64, "base64");
        privateKeyObject = crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    } catch (e) {
        console.error("[licenseToken] Failed to load LICENSE_SIGNING_PRIVATE_KEY:", e);
    }
} else {
    console.warn(
        "[licenseToken] LICENSE_SIGNING_PRIVATE_KEY is not set -- activate/validate " +
        "responses will NOT include a licenseToken, and the app will refuse to unlock."
    );
}

export interface LicenseTokenPayload {
    licenseKey: string;
    email: string;
    deviceId: string;
    status: string;
    expiresAt: string | null;
    issuedAt: string;
}

export interface SignedLicenseToken {
    payload: string; // base64url of the JSON payload
    signature: string; // base64url Ed25519 signature over the raw payload bytes
}

/**
 * Signs a license token for this exact device/key/status combination.
 * Returns null if the signing key isn't configured -- callers should
 * omit `licenseToken` from the response in that case, which the app
 * treats as "not activated" (fails closed).
 */
export function signLicenseToken(
    params: Omit<LicenseTokenPayload, "issuedAt">
): SignedLicenseToken | null {
    if (!privateKeyObject) return null;

    const payload: LicenseTokenPayload = {
        ...params,
        issuedAt: new Date().toISOString(),
    };

    const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
    const signatureBytes = crypto.sign(null, payloadBytes, privateKeyObject);


    console.log("[licenseToken] Token generated");
    console.log("[licenseToken] deviceId:", params.deviceId);
    console.log("[licenseToken] email:", params.email);
    console.log("[licenseToken] status:", params.status);
    console.log("[licenseToken] hasPrivateKey:", !!privateKeyObject);
    console.log("[licenseToken] signatureLength:", signatureBytes.length);

    return {
        payload: payloadBytes.toString("base64url"),
        signature: signatureBytes.toString("base64url"),
    };
}

if (privateKeyObject) {
    const publicKey = crypto.createPublicKey(privateKeyObject);

    const publicDer = publicKey.export({
        type: "spki",
        format: "der",
    });

    const publicRaw = publicDer.subarray(-32);

    console.log(
        "[licenseToken] BACKEND PUBLIC KEY:",
        publicRaw.toString("base64")
    );
}