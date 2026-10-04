'use client';
import { PrismaClient } from '@prisma/client';

export function Prisma() {
  return PrismaClient;
}
