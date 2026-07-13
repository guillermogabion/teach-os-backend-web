import { prisma } from "@/config/prisma";
import { ApiError } from "@/middleware/errorHandler";

// Voucher codes are matched case-insensitively but SQLite can't do that
// reliably in a `where` filter (same issue as normalizeEmail in
// license.service.ts) — so codes are stored and looked up uppercased.
function normalizeCode(code: string): string {
    return code.trim().toUpperCase();
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

interface VoucherInput {
    code: string;
    name: string;
    description?: string | null;
    discountType: "PERCENTAGE" | "FIXED";
    discountAmount?: number;
    bonusDays?: number;
    maxUsage?: number; // 0 = unlimited
    expiresAt?: Date | null;
    isActive?: boolean;
    firstTimeOnly?: boolean;
    premiumOnly?: boolean;
    eligiblePlanIds?: string[]; // empty = valid for every plan
    campaignId?: string | null;
}

export async function createVoucher(input: VoucherInput) {
    const code = normalizeCode(input.code);

    const existing = await prisma.voucherCode.findUnique({ where: { code } });
    if (existing) throw new ApiError(409, `Voucher code "${code}" already exists`);

    if (input.campaignId) {
        const campaign = await prisma.promoCampaign.findUnique({ where: { id: input.campaignId } });
        if (!campaign) throw new ApiError(404, "Campaign not found");
    }

    if (!input.discountAmount && !input.bonusDays) {
        throw new ApiError(400, "Set a discount amount, bonus days, or both — a voucher needs to do something");
    }

    return prisma.voucherCode.create({
        data: {
            code,
            name: input.name,
            description: input.description ?? null,
            discountType: input.discountType,
            discountAmount: input.discountAmount ?? 0,
            bonusDays: input.bonusDays ?? 0,
            maxUsage: input.maxUsage ?? 0,
            expiresAt: input.expiresAt ?? null,
            isActive: input.isActive ?? true,
            firstTimeOnly: input.firstTimeOnly ?? false,
            premiumOnly: input.premiumOnly ?? false,
            campaignId: input.campaignId ?? null,
            ...(input.eligiblePlanIds?.length
                ? { eligiblePlans: { connect: input.eligiblePlanIds.map((id) => ({ id })) } }
                : {}),
        },
        include: { eligiblePlans: true, campaign: true },
    });
}

type VoucherUpdateInput = Partial<Omit<VoucherInput, "code">> & { code?: string };

export async function updateVoucher(id: string, input: VoucherUpdateInput) {
    const voucher = await prisma.voucherCode.findUnique({ where: { id } });
    if (!voucher) throw new ApiError(404, "Voucher not found");

    if (input.code && normalizeCode(input.code) !== voucher.code) {
        const code = normalizeCode(input.code);
        const clash = await prisma.voucherCode.findUnique({ where: { code } });
        if (clash) throw new ApiError(409, `Voucher code "${code}" already exists`);
    }

    if (input.campaignId) {
        const campaign = await prisma.promoCampaign.findUnique({ where: { id: input.campaignId } });
        if (!campaign) throw new ApiError(404, "Campaign not found");
    }

    return prisma.voucherCode.update({
        where: { id },
        data: {
            ...(input.code ? { code: normalizeCode(input.code) } : {}),
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.discountType !== undefined ? { discountType: input.discountType } : {}),
            ...(input.discountAmount !== undefined ? { discountAmount: input.discountAmount } : {}),
            ...(input.bonusDays !== undefined ? { bonusDays: input.bonusDays } : {}),
            ...(input.maxUsage !== undefined ? { maxUsage: input.maxUsage } : {}),
            ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
            ...(input.firstTimeOnly !== undefined ? { firstTimeOnly: input.firstTimeOnly } : {}),
            ...(input.premiumOnly !== undefined ? { premiumOnly: input.premiumOnly } : {}),
            ...(input.campaignId !== undefined ? { campaignId: input.campaignId } : {}),
            ...(input.eligiblePlanIds !== undefined
                ? { eligiblePlans: { set: input.eligiblePlanIds.map((id) => ({ id })) } }
                : {}),
        },
        include: { eligiblePlans: true, campaign: true },
    });
}

export async function toggleVoucherActive(id: string) {
    const voucher = await prisma.voucherCode.findUnique({ where: { id } });
    if (!voucher) throw new ApiError(404, "Voucher not found");
    return prisma.voucherCode.update({ where: { id }, data: { isActive: !voucher.isActive } });
}

// Hard delete is only allowed if the voucher was never redeemed — once
// it's been used, past payments/redemptions still need a real row to
// resolve, so we deactivate instead.
export async function deleteVoucher(id: string) {
    const voucher = await prisma.voucherCode.findUnique({ where: { id } });
    if (!voucher) throw new ApiError(404, "Voucher not found");
    if (voucher.currentUsage > 0) {
        throw new ApiError(
            409,
            "This voucher has already been redeemed and can't be deleted — deactivate it instead."
        );
    }
    await prisma.voucherCode.delete({ where: { id } });
}

interface ListVouchersParams {
    page: number;
    pageSize: number;
    search?: string;
    campaignId?: string;
    isActive?: boolean;
}

export async function listVouchers({ page, pageSize, search, campaignId, isActive }: ListVouchersParams) {
    const where = {
        ...(search
            ? {
                OR: [{ code: { contains: normalizeCode(search) } }, { name: { contains: search } }],
            }
            : {}),
        ...(campaignId ? { campaignId } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
    };

    const [items, total] = await Promise.all([
        prisma.voucherCode.findMany({
            where,
            include: { eligiblePlans: true, campaign: true },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.voucherCode.count({ where }),
    ]);
    return { items, total, page, pageSize };
}

export async function getVoucher(id: string) {
    const voucher = await prisma.voucherCode.findUnique({
        where: { id },
        include: { eligiblePlans: true, campaign: true },
    });
    if (!voucher) throw new ApiError(404, "Voucher not found");
    return voucher;
}

interface ValidateVoucherParams {
    code: string;
    planId: string;
    amount: number;
    buyerEmail?: string | null;
}

export interface VoucherEffect {
    voucherId: string;
    finalAmount: number;
    discountApplied: number;
    bonusDays: number;
}

/**
 * Checks a voucher against a specific plan/buyer/amount and returns the
 * resulting price + bonus days — but does NOT record a redemption or
 * touch currentUsage. Safe to call repeatedly (e.g. a buyer-facing
 * "apply code" preview button). Actual usage is only recorded by
 * redeemVoucher(), called once at the point a payment is actually
 * created.
 */
export async function validateVoucher({
    code,
    planId,
    amount,
    buyerEmail,
}: ValidateVoucherParams): Promise<VoucherEffect> {
    const voucher = await prisma.voucherCode.findUnique({
        where: { code: normalizeCode(code) },
        include: { eligiblePlans: true },
    });

    if (!voucher) throw new ApiError(404, "Voucher code not found");
    if (!voucher.isActive) throw new ApiError(400, "This voucher is no longer active");
    if (voucher.expiresAt && voucher.expiresAt < new Date()) {
        throw new ApiError(400, "This voucher has expired");
    }
    if (voucher.maxUsage > 0 && voucher.currentUsage >= voucher.maxUsage) {
        throw new ApiError(400, "This voucher has reached its usage limit");
    }
    if (voucher.eligiblePlans.length > 0 && !voucher.eligiblePlans.some((p) => p.id === planId)) {
        throw new ApiError(400, "This voucher isn't valid for the selected plan");
    }

    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new ApiError(404, "Plan not found");

    if (voucher.premiumOnly && plan.price <= 0) {
        throw new ApiError(400, "This voucher only applies to paid plans");
    }

    const normalizedEmail = buyerEmail?.trim().toLowerCase();

    if (voucher.firstTimeOnly) {
        if (!normalizedEmail) {
            throw new ApiError(400, "This voucher requires an email to check first-time eligibility");
        }
        const priorPaidPayment = await prisma.payment.findFirst({
            where: { buyerEmail: normalizedEmail, status: "PAID" },
        });
        if (priorPaidPayment) {
            throw new ApiError(400, "This voucher is for first-time buyers only");
        }
    }

    if (normalizedEmail) {
        const alreadyRedeemed = await prisma.voucherRedemption.findUnique({
            where: { voucherId_email: { voucherId: voucher.id, email: normalizedEmail } },
        });
        if (alreadyRedeemed) {
            throw new ApiError(409, "This voucher has already been used with this email");
        }
    }

    const finalAmount =
        voucher.discountType === "PERCENTAGE"
            ? Math.max(0, round2(amount * (1 - voucher.discountAmount / 100)))
            : Math.max(0, round2(amount - voucher.discountAmount));

    return {
        voucherId: voucher.id,
        finalAmount,
        discountApplied: round2(amount - finalAmount),
        bonusDays: voucher.bonusDays,
    };
}

/**
 * Records that `email` used `voucherId` and atomically bumps
 * currentUsage — called exactly once, from inside the payment flow,
 * right after a payment/license was actually created. Re-checks
 * maxUsage inside the transaction so two people redeeming the last
 * slot at the same instant can't both win the race validateVoucher()
 * alone can't fully prevent.
 */
export async function redeemVoucher(voucherId: string, email: string, paymentId: string) {
    const normalizedEmail = email.trim().toLowerCase();

    return prisma.$transaction(async (tx) => {
        const voucher = await tx.voucherCode.findUnique({ where: { id: voucherId } });
        if (!voucher) throw new ApiError(404, "Voucher not found");
        if (voucher.maxUsage > 0 && voucher.currentUsage >= voucher.maxUsage) {
            throw new ApiError(400, "This voucher has reached its usage limit");
        }

        const existing = await tx.voucherRedemption.findUnique({
            where: { voucherId_email: { voucherId, email: normalizedEmail } },
        });
        if (existing) throw new ApiError(409, "This voucher has already been used with this email");

        await tx.voucherCode.update({ where: { id: voucherId }, data: { currentUsage: { increment: 1 } } });

        return tx.voucherRedemption.create({
            data: { voucherId, email: normalizedEmail, paymentId },
        });
    });
}