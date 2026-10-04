import { Router } from 'express';
import { handler } from '../routes/users';

export function find() {
  return [Router, handler];
}
