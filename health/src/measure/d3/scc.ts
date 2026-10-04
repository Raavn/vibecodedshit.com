/** Strongly connected components of two or more nodes (Tarjan, iterative). Self loops are ignored. */
export function cyclicNodes(nodes: Iterable<string>, edges: Iterable<[string, string]>): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node, []);
  for (const [from, to] of edges) {
    if (from !== to && adjacency.has(from) && adjacency.has(to)) adjacency.get(from)?.push(to);
  }
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result = new Set<string>();
  let counter = 0;

  for (const start of adjacency.keys()) {
    if (index.has(start)) continue;
    const work: { node: string; next: number }[] = [{ node: start, next: 0 }];
    index.set(start, counter);
    low.set(start, counter);
    counter += 1;
    stack.push(start);
    onStack.add(start);
    while (work.length > 0) {
      const frame = work[work.length - 1] as { node: string; next: number };
      const neighbours = adjacency.get(frame.node) as string[];
      if (frame.next < neighbours.length) {
        const to = neighbours[frame.next] as string;
        frame.next += 1;
        if (!index.has(to)) {
          index.set(to, counter);
          low.set(to, counter);
          counter += 1;
          stack.push(to);
          onStack.add(to);
          work.push({ node: to, next: 0 });
        } else if (onStack.has(to)) {
          low.set(frame.node, Math.min(low.get(frame.node) as number, index.get(to) as number));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.node, Math.min(low.get(parent.node) as number, low.get(frame.node) as number));
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        for (;;) {
          const member = stack.pop() as string;
          onStack.delete(member);
          component.push(member);
          if (member === frame.node) break;
        }
        if (component.length >= 2) for (const member of component) result.add(member);
      }
    }
  }
  return result;
}
