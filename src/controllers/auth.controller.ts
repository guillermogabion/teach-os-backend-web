import { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler, ApiError } from "@/middleware/errorHandler";
import * as authService from "@/services/auth.service";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const loginHandler = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = loginSchema.parse(req.body);

  const result = await authService.login({
    email,
    password,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  });

  res.json(result);
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

export const refreshHandler = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = refreshSchema.parse(req.body);
  const result = await authService.refresh(refreshToken);
  res.json(result);
});

export const logoutHandler = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = refreshSchema.parse(req.body);
  await authService.logout(refreshToken);
  res.json({ success: true });
});

export const meHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Not authenticated");
  res.json({ user: req.user });
});
