import { a } from '@/lib/a';
import { fmt } from '@/lib/util';

export default function Page() {
  return fmt() + String(a());
}
