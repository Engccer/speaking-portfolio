const SEED_PREFIX = "2026-2-speaking";
const N = 9;

export async function drawExam(cls, num) {
  const data = new TextEncoder().encode(`${SEED_PREFIX}|${cls}|${num}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const first = hash[0] % N;
  let second = hash[1] % (N - 1);
  if (second >= first) second += 1;
  return [first, second];
}

export function drawPractice() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % N;
}
