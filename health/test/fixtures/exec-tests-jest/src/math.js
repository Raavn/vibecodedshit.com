function add(a, b) {
  return a + b;
}
function clamp(n, lo, hi) {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
module.exports = { add, clamp };
