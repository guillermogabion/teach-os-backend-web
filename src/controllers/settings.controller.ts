import { Request, Response } from "express";
import { prisma } from "@/config/prisma";
import { asyncHandler, ApiError } from "@/middleware/errorHandler";
import {
  isSettingsGroup,
  getAllSettings,
  getGroupSettings,
  updateGroupSettings,
  resetGroupSettings,
} from "@/services/settings.service";

function requireValidGroup(groupParam: string) {
  if (!isSettingsGroup(groupParam)) {
    throw new ApiError(404, `Unknown settings group: ${groupParam}`);
  }
  return groupParam;
}

function logSettingsChange(req: Request, action: string, group: string, meta?: unknown) {
  return prisma.auditLog.create({
    data: {
      userId: req.user?.sub,
      action,
      entity: "Setting",
      entityId: group,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      meta: meta ? JSON.stringify(meta) : undefined,
    },
  });
}

export const getAllSettingsHandler = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getAllSettings());
});

export const getGroupSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const group = requireValidGroup(req.params.group);
  res.json(await getGroupSettings(group));
});

export const updateGroupSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const group = requireValidGroup(req.params.group);
  const updated = await updateGroupSettings(group, req.body);
  await logSettingsChange(req, "SETTINGS_UPDATED", group, req.body);
  res.json(updated);
});

export const resetGroupSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const group = requireValidGroup(req.params.group);
  const defaults = await resetGroupSettings(group);
  await logSettingsChange(req, "SETTINGS_RESET", group);
  res.json(defaults);
});
