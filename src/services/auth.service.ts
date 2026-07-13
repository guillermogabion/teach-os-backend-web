import { prisma } from "@/config/prisma";
import { hashPassword, verifyPassword } from "@/utils/password";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "@/utils/jwt";
import { ApiError } from "@/middleware/errorHandler";
import { env } from "@/config/env";

interface LoginParams {
  email: string;
  password: string;
  ip?: string;
  userAgent?: string;
}

function refreshExpiryDate(): Date {
  // Best-effort parse of durations like "7d" / "15m"; falls back to 7 days.
  const match = env.jwtRefreshExpiresIn.match(/^(\d+)([smhd])$/);
  const now = Date.now();
  if (!match) return new Date(now + 7 * 24 * 60 * 60 * 1000);
  const value = Number(match[1]);
  const unit = match[2];
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 86_400_000;
  return new Date(now + value * unitMs);
}

export async function login({ email, password, ip, userAgent }: LoginParams) {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { role: true },
  });

  const success = !!user && (await verifyPassword(password, user.passwordHash));

  if (user) {
    await prisma.loginLog.create({
      data: { userId: user.id, ip, userAgent, success },
    });
  }

  if (!user || !success) {
    throw new ApiError(401, "Invalid email or password");
  }
  if (user.isBanned) throw new ApiError(403, "Account is banned");
  if (user.isSuspended) throw new ApiError(403, "Account is suspended");
  if (!user.isActive) throw new ApiError(403, "Account is inactive");

  const accessToken = signAccessToken({
    sub: user.id,
    role: user.role.name,
    email: user.email,
  });

  // Create the DB row first so tokenId can be embedded in the JWT
  // and checked/revoked later (supports multi-device login tracking).
  const refreshRow = await prisma.refreshToken.create({
    data: {
      token: "pending",
      userId: user.id,
      userAgent,
      ip,
      expiresAt: refreshExpiryDate(),
    },
  });

  const refreshToken = signRefreshToken({ sub: user.id, tokenId: refreshRow.id });
  await prisma.refreshToken.update({
    where: { id: refreshRow.id },
    data: { token: refreshToken },
  });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role.name,
    },
  };
}

export async function refresh(refreshToken: string) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new ApiError(401, "Invalid or expired refresh token");
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { id: payload.tokenId },
    include: { user: { include: { role: true } } },
  });

  if (!stored || stored.revoked || stored.token !== refreshToken) {
    throw new ApiError(401, "Refresh token has been revoked");
  }
  if (stored.expiresAt < new Date()) {
    throw new ApiError(401, "Refresh token expired");
  }

  // Rotate: revoke the old token and issue a new pair.
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revoked: true },
  });

  const newRow = await prisma.refreshToken.create({
    data: {
      token: "pending",
      userId: stored.userId,
      userAgent: stored.userAgent,
      ip: stored.ip,
      expiresAt: refreshExpiryDate(),
    },
  });
  const newRefreshToken = signRefreshToken({ sub: stored.userId, tokenId: newRow.id });
  await prisma.refreshToken.update({
    where: { id: newRow.id },
    data: { token: newRefreshToken },
  });

  const accessToken = signAccessToken({
    sub: stored.user.id,
    role: stored.user.role.name,
    email: stored.user.email,
  });

  return { accessToken, refreshToken: newRefreshToken };
}

export async function logout(refreshToken: string) {
  await prisma.refreshToken.updateMany({
    where: { token: refreshToken },
    data: { revoked: true },
  });
}

export async function createAdminUser(params: {
  email: string;
  password: string;
  name: string;
  role: "SUPER_ADMIN" | "ADMIN" | "SUPPORT";
}) {
  const roleRow = await prisma.role.findUnique({ where: { name: params.role } });
  if (!roleRow) throw new ApiError(400, `Role ${params.role} not seeded`);

  const passwordHash = await hashPassword(params.password);
  return prisma.user.create({
    data: {
      email: params.email,
      passwordHash,
      name: params.name,
      roleId: roleRow.id,
    },
  });
}
