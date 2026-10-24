// Cosmetic locomotion driven ONLY by the authoritative native run state.
// A stop freezes phase/position/cargo; resuming the same UUID continues there.
export const W = 1916, H = 1075;
export const MINERALS = [[765,351],[753,446],[834,552],[980,645]];
export function createWorker(id, slot = 0) {
  const lane = slot % 4;
  return { id, lane, phase: 0, x: 1012 + lane * 49, y: 469 + (lane % 2) * 34, cargo: false, moving: false, mining: false, facing: -1, travelTime: 0 };
}
export function advanceWorker(u, dt, active) {
  if (!active) { u.moving = false; u.mining = false; return u; }
  u.phase = (u.phase + Math.max(0, Math.min(dt, .1))) % 10.4;
  const start = [1012 + u.lane * 49, 469 + (u.lane % 2) * 34], end = MINERALS[u.lane];
  const t = u.phase;
  let q = 0;
  if (t < 4.2) { q = t / 4.2; u.cargo = false; u.moving = true; u.mining = false; u.facing = -1; }
  else if (t < 5.4) { q = 1; u.cargo = false; u.moving = false; u.mining = true; u.facing = -1; }
  else if (t < 9.6) { q = 1 - (t - 5.4) / 4.2; u.cargo = true; u.moving = true; u.mining = false; u.facing = 1; }
  else { q = 0; u.cargo = false; u.moving = false; u.mining = false; }
  u.x = start[0] + (end[0] - start[0]) * q;
  u.y = start[1] + (end[1] - start[1]) * q;
  u.travelTime += dt;
  return u;
}
