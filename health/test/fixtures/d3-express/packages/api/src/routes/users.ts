import { find } from '../services/user-service';

export function handler() {
  return find();
}
