'use client';
import { db } from '../server/db';

export function Widget() {
  return db();
}
