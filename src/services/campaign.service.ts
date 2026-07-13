import { prisma } from "@/config/prisma";
import { ApiError } from "@/middleware/errorHandler";

interface CampaignInput {
    name: string;
    startDate: Date;
    endDate: Date;
    bannerUrl?: string | null;
    isActive?: boolean;
}

export async function createCampaign(input: CampaignInput) {
    if (input.endDate <= input.startDate) {
        throw new ApiError(400, "End date must be after start date");
    }
    return prisma.promoCampaign.create({
        data: {
            name: input.name,
            startDate: input.startDate,
            endDate: input.endDate,
            bannerUrl: input.bannerUrl ?? null,
            isActive: input.isActive ?? true,
        },
    });
}

export async function updateCampaign(id: string, input: Partial<CampaignInput>) {
    const campaign = await prisma.promoCampaign.findUnique({ where: { id } });
    if (!campaign) throw new ApiError(404, "Campaign not found");

    const startDate = input.startDate ?? campaign.startDate;
    const endDate = input.endDate ?? campaign.endDate;
    if (endDate <= startDate) {
        throw new ApiError(400, "End date must be after start date");
    }

    return prisma.promoCampaign.update({
        where: { id },
        data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
            ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
            ...(input.bannerUrl !== undefined ? { bannerUrl: input.bannerUrl } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
    });
}

export async function listCampaigns() {
    return prisma.promoCampaign.findMany({
        include: { vouchers: { select: { id: true, code: true, isActive: true } } },
        orderBy: { createdAt: "desc" },
    });
}

export async function getCampaign(id: string) {
    const campaign = await prisma.promoCampaign.findUnique({
        where: { id },
        include: { vouchers: true },
    });
    if (!campaign) throw new ApiError(404, "Campaign not found");
    return campaign;
}

// Detaches (doesn't delete) any vouchers still pointing at this campaign
// before removing it, since VoucherCode.campaignId has no onDelete
// cascade — leaving it dangling would break voucher reads.
export async function deleteCampaign(id: string) {
    const campaign = await prisma.promoCampaign.findUnique({ where: { id } });
    if (!campaign) throw new ApiError(404, "Campaign not found");

    await prisma.$transaction([
        prisma.voucherCode.updateMany({ where: { campaignId: id }, data: { campaignId: null } }),
        prisma.promoCampaign.delete({ where: { id } }),
    ]);
}