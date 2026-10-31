import { Prisma, PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
export type Tx = Prisma.TransactionClient;

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
