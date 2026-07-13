import { prisma } from "@/config/prisma";
import { ApiError } from "@/middleware/errorHandler";
import { getGroupSettings } from "@/services/settings.service";
import * as licenseService from "@/services/license.service";
import * as voucherService from "@/services/voucher.service";
import { sendActivationKeyEmail, sendAdminPendingPaymentEmail } from "@/services/mailer.service";

interface CreatePaymentParams {
    planId: string;
    amount: number;
    provider: string; // GCASH | PAYMONGO | STRIPE | MAYA
    currency?: string;
    receiptUrl?: string;
    buyerEmail?: string;
    buyerName?: string;
    voucherCode?: string; // optional promo/discount code applied at checkout
}

// Shared by createPayment (auto-issue) and approvePayment (manual/idempotent
// re-issue path) so the "mark paid + generate license + email the key"
// logic only lives in one place. bonusDays is added on top of the plan's
// normal license length — comes from a redeemed voucher, or 0.
async function issueLicenseForPayment(
    paymentId: string,
    planId: string,
    buyerEmail?: string | null,
    bonusDays = 0
) {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new ApiError(404, "Plan not found");

    const subscriptionSettings = await getGroupSettings("subscription");

    const baseExpiresInDays =
        plan.billingCycle === "YEARLY" ? 365 : plan.billingCycle === "ONE_TIME" ? undefined : 30;
    // A perpetual (ONE_TIME) plan has no expiry to extend — bonus days
    // only make sense stacked on top of an actual window.
    const expiresInDays = baseExpiresInDays === undefined ? undefined : baseExpiresInDays + bonusDays;

    const [updatedPayment, license] = await Promise.all([
        prisma.payment.update({ where: { id: paymentId }, data: { status: "PAID" } }),
        licenseService.createLicense({
            planId,
            email: buyerEmail,
            maxDevices: subscriptionSettings.maxDevicesPerPlan,
            expiresInDays,
        }),
    ]);

    if (updatedPayment.buyerEmail) {
        await sendActivationKeyEmail(
            updatedPayment.buyerEmail,
            updatedPayment.buyerName,
            plan.name,
            license.key
        );
    }

    return { payment: updatedPayment, license };
}

// Simulates a payment coming in (e.g. someone sent GCash and an admin is
// logging it manually, or a future gateway webhook lands here). No real
// gateway is wired up yet — this immediately issues the license and
// emails the activation key so the whole flow can be tested in one call,
// without a separate manual approval step.
//
// There's no User account requirement here: buying an activation key is
// an anonymous/reseller-style purchase (see License model comment) — the
// buyer doesn't need to exist in the system until they activate the key
// in the app later. buyerEmail/buyerName are plain text, not a relation.
export async function createPayment(params: CreatePaymentParams) {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: params.planId } });
    if (!plan) throw new ApiError(404, "Plan not found");

    // Check before creating anything: if this buyer already has an
    // active or pending license, refuse the purchase outright rather
    // than creating a payment record we know can't be fulfilled.
    if (params.buyerEmail && (await licenseService.hasActiveLicenseForEmail(params.buyerEmail))) {
        throw new ApiError(
            409,
            "This email already has an active or pending license. A new purchase isn't allowed until the current one is activated-and-expires, or is revoked."
        );
    }

    let finalAmount = params.amount;
    let voucherEffect: voucherService.VoucherEffect | null = null;

    if (params.voucherCode) {
        // Redemption is deduped by email, so a code can't be applied to
        // a purchase with no buyer identity attached.
        if (!params.buyerEmail) {
            throw new ApiError(400, "An email is required to apply a voucher code");
        }
        voucherEffect = await voucherService.validateVoucher({
            code: params.voucherCode,
            planId: params.planId,
            amount: params.amount,
            buyerEmail: params.buyerEmail,
        });
        finalAmount = voucherEffect.finalAmount;
    }

    const payment = await prisma.payment.create({
        data: {
            planId: params.planId,
            buyerEmail: params.buyerEmail,
            buyerName: params.buyerName,
            amount: finalAmount,
            originalAmount: voucherEffect ? params.amount : null,
            discountApplied: voucherEffect?.discountApplied ?? 0,
            bonusDaysApplied: voucherEffect?.bonusDays ?? 0,
            voucherId: voucherEffect?.voucherId ?? null,
            currency: params.currency ?? "PHP",
            provider: params.provider,
            status: "PENDING",
            receiptUrl: params.receiptUrl,
        },
    });

    const { payment: paidPayment, license } = await issueLicenseForPayment(
        payment.id,
        params.planId,
        params.buyerEmail,
        voucherEffect?.bonusDays ?? 0
    );

    // Voucher usage is only committed once the payment (and its license)
    // actually exist — validateVoucher() above only checked eligibility,
    // it never touched currentUsage.
    if (voucherEffect && params.buyerEmail) {
        await voucherService.redeemVoucher(voucherEffect.voucherId, params.buyerEmail, payment.id);
    }

    // FYI-only notice to admins that a payment came in and was
    // auto-processed — best-effort, never blocks the response.
    await sendAdminPendingPaymentEmail(
        payment.id,
        params.buyerEmail,
        params.buyerName,
        plan.name,
        finalAmount,
        payment.currency,
        params.provider
    );

    return { payment: paidPayment, license };
}

interface ListPaymentsParams {
    page: number;
    pageSize: number;
    status?: string;
}

export async function listPayments({ page, pageSize, status }: ListPaymentsParams) {
    const where = status ? { status } : {};
    const [items, total] = await Promise.all([
        prisma.payment.findMany({
            where,
            include: { plan: true, subscription: { include: { plan: true } }, voucher: true },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.payment.count({ where }),
    ]);
    return { items, total, page, pageSize };
}

export async function getPayment(id: string) {
    const payment = await prisma.payment.findUnique({
        where: { id },
        include: { plan: true, subscription: { include: { plan: true } }, voucher: true },
    });
    if (!payment) throw new ApiError(404, "Payment not found");
    return payment;
}

/**
 * Manually (re-)issues a license for a payment. Reuses whatever bonus
 * days were already recorded on the payment at creation time — it does
 * NOT re-validate or re-redeem the voucher, since that already happened
 * once when the payment was first created.
 */
export async function approvePayment(paymentId: string) {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new ApiError(404, "Payment not found");
    if (payment.status === "PAID") {
        throw new ApiError(409, "Payment has already been approved");
    }
    if (!payment.planId) throw new ApiError(400, "Payment has no associated plan");

    const bonusDaysApplied = (payment as typeof payment & { bonusDaysApplied?: number | null }).bonusDaysApplied ?? 0;

    return issueLicenseForPayment(paymentId, payment.planId, payment.buyerEmail, bonusDaysApplied);
}

export async function rejectPayment(id: string) {
    const payment = await prisma.payment.findUnique({ where: { id } });
    if (!payment) throw new ApiError(404, "Payment not found");
    return prisma.payment.update({ where: { id }, data: { status: "FAILED" } });
}

export async function refundPayment(id: string) {
    const payment = await prisma.payment.findUnique({ where: { id } });
    if (!payment) throw new ApiError(404, "Payment not found");
    if (payment.status !== "PAID") {
        throw new ApiError(400, "Only a paid payment can be refunded");
    }
    return prisma.payment.update({ where: { id }, data: { status: "REFUNDED" } });
}