import { z } from "zod";
import { prisma } from "@/config/prisma";
import { ApiError } from "@/middleware/errorHandler";

// ---------- Group definitions ----------
// Each settings group is stored as a single row in the `Setting` table
// (key = group name, value = JSON blob), merged over these defaults on
// read so a group that's never been saved still returns something sane.

export const SETTINGS_GROUPS = ["subscription", "payments", "voucher", "system"] as const;
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

export function isSettingsGroup(value: string): value is SettingsGroup {
  return (SETTINGS_GROUPS as readonly string[]).includes(value);
}

const subscriptionSchema = z.object({
  monthlyPremiumPrice: z.number().min(0),
  quarterlyPremiumPrice: z.number().min(0).nullable(),
  yearlyPremiumPrice: z.number().min(0),
  freeTrialDays: z.number().int().min(0),
  maxDevicesPerPlan: z.number().int().min(1),
  offlineGracePeriodDays: z.number().int().min(0),
});

const paymentsSchema = z.object({
  gcashNumber: z.string(),
  mayaNumber: z.string(),
  bankAccountDetails: z.string(),
  paymentInstructions: z.string(),
  autoApproval: z.boolean(),
});

const voucherSchema = z.object({
  defaultExpirationDays: z.number().int().min(1),
  maxVoucherUses: z.number().int().min(1),
  codePrefix: z
    .string()
    .max(10)
    .regex(/^[A-Za-z0-9_-]*$/, "Prefix may only contain letters, numbers, - and _"),
  codeLength: z.number().int().min(4).max(32),
});

const systemSchema = z.object({
  maintenanceMode: z.boolean(),
  latestAppVersion: z.string(),
  minSupportedAppVersion: z.string(),
  forceUpdateVersion: z.string().nullable(),
});

export const SETTINGS_SCHEMAS = {
  subscription: subscriptionSchema,
  payments: paymentsSchema,
  voucher: voucherSchema,
  system: systemSchema,
} satisfies Record<SettingsGroup, z.ZodTypeAny>;

export const SETTINGS_DEFAULTS: {
  subscription: z.infer<typeof subscriptionSchema>;
  payments: z.infer<typeof paymentsSchema>;
  voucher: z.infer<typeof voucherSchema>;
  system: z.infer<typeof systemSchema>;
} = {
  subscription: {
    monthlyPremiumPrice: 299,
    quarterlyPremiumPrice: null,
    yearlyPremiumPrice: 2999,
    freeTrialDays: 14,
    maxDevicesPerPlan: 2,
    offlineGracePeriodDays: 7,
  },
  payments: {
    gcashNumber: "",
    mayaNumber: "",
    bankAccountDetails: "",
    paymentInstructions: "",
    autoApproval: false,
  },
  voucher: {
    defaultExpirationDays: 30,
    maxVoucherUses: 100,
    codePrefix: "TEACHOS",
    codeLength: 8,
  },
  system: {
    maintenanceMode: false,
    latestAppVersion: "1.0.0",
    minSupportedAppVersion: "1.0.0",
    forceUpdateVersion: null,
  },
};

export type SettingsValue<G extends SettingsGroup> = (typeof SETTINGS_DEFAULTS)[G];

function settingKeyFor(group: SettingsGroup): string {
  return `settings.${group}`;
}

export async function getGroupSettings<G extends SettingsGroup>(
  group: G
): Promise<SettingsValue<G>> {
  const row = await prisma.setting.findUnique({ where: { key: settingKeyFor(group) } });
  if (!row) return SETTINGS_DEFAULTS[group];

  try {
    const stored = JSON.parse(row.value);
    // Merge over defaults so newly-added fields on older saved rows
    // still come back populated instead of undefined.
    return { ...SETTINGS_DEFAULTS[group], ...stored };
  } catch {
    return SETTINGS_DEFAULTS[group];
  }
}

export async function getAllSettings() {
  const entries = await Promise.all(
    SETTINGS_GROUPS.map(async (group) => [group, await getGroupSettings(group)] as const)
  );
  return Object.fromEntries(entries) as {
    [G in SettingsGroup]: SettingsValue<G>;
  };
}

export async function updateGroupSettings<G extends SettingsGroup>(
  group: G,
  partialInput: unknown
) {
  const schema = SETTINGS_SCHEMAS[group];
  const partialResult = (schema as z.ZodObject<any>).partial().safeParse(partialInput);
  if (!partialResult.success) {
    throw new ApiError(400, partialResult.error.issues.map((i) => i.message).join("; "));
  }

  const current = await getGroupSettings(group);
  const merged = { ...current, ...partialResult.data };

  // Re-validate the fully merged object so a partial update can never
  // leave the group in a state that wouldn't pass validation on its own.
  const fullResult = schema.safeParse(merged);
  if (!fullResult.success) {
    throw new ApiError(400, fullResult.error.issues.map((i) => i.message).join("; "));
  }

  await prisma.setting.upsert({
    where: { key: settingKeyFor(group) },
    update: { value: JSON.stringify(fullResult.data) },
    create: { key: settingKeyFor(group), value: JSON.stringify(fullResult.data) },
  });

  return fullResult.data as SettingsValue<G>;
}

export async function resetGroupSettings<G extends SettingsGroup>(group: G) {
  await prisma.setting.deleteMany({ where: { key: settingKeyFor(group) } });
  return SETTINGS_DEFAULTS[group];
}
