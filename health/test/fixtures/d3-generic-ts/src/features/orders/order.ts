import { cart } from '../cart';
import { makeCart } from '../cart/cart';

export function order() {
  return [cart, makeCart];
}
