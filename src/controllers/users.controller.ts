import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@/config/prisma";
import { asyncHandler, ApiError } from "@/middleware/errorHandler";
import bcrypt from "bcryptjs";


const listQuerySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const createUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  roleId: z.string().min(1, "Role is required"),
});

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const { search, page, pageSize } = listQuerySchema.parse(req.query);

  const where = search
    ? {
      OR: [
        { name: { contains: search } },
        { email: { contains: search } },
      ],
    }
    : {};

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: { role: true, subscriptions: { include: { plan: true } } },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.count({ where }),
  ]);

  res.json({ items, total, page, pageSize });
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: {
      role: true,
      teacherProfile: true,
      subscriptions: { include: { plan: true } },
      payments: true,
      loginLogs: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!user) throw new ApiError(404, "User not found");
  res.json(user);
});

export const suspendUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { isSuspended: true },
  });
  res.json(user);
});

export const unsuspendUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { isSuspended: false },
  });
  res.json(user);
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  await prisma.user.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export const listRoles = asyncHandler(async (req: Request, res: Response) => {
  const roles = await prisma.role.findMany({
    select: { id: true, name: true, description: true },
    orderBy: { createdAt: "asc" },
  });

  res.json(roles);
});


export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const { name, email, password, roleId } = createUserSchema.parse(req.body);

  // 1. Check if the email is already in use
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new ApiError(400, "A user with this email already exists");
  }

  // 2. Hash the plain-text password
  const passwordHash = await bcrypt.hash(password, 12);

  // 3. Save the new user to the database
  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      roleId,
    },
    // We select specific fields so we don't accidentally send the passwordHash back to the frontend
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      isSuspended: true,
      createdAt: true,
    }
  });

  res.status(201).json(user);
});