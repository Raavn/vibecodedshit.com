import { query } from '../infra/db-client';

export function repo() {
  return query;
}
