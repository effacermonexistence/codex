// Cosmetic locomotion driven ONLY by the authoritative native run state.
// A stop freezes phase/position/cargo; resuming the same UUID continues there.
export const W = 640, H = 480;
export const MINERALS = [[480,55],[519,103],[526,160],[551,257]];
export function createWorker(id, slot = 0) {
  const lane = slot % 4;
  return { id, lane, phase: 0, x: 407 + lane * 13, y: 224 + (lane % 2) * 19, cargo: false, moving: false, mining: false, facing: -1, travelTime: 0 };
}
export function advanceWorker(u, dt, active) {
  if (!active) { u.moving = false; u.mining = false; return u; }
  u.phase = (u.phase + Math.max(0, Math.min(dt, .1))) % 10.4;
  const start = [407 + u.lane * 13, 224 + (u.lane % 2) * 19], end = MINERALS[u.lane];
  const t = u.phase;
  let q = 0;
  if (t < 4.2) { q = t / 4.2; u.cargo = false; u.moving = true; u.mining = false; u.facing = 1; }
  else if (t < 5.4) { q = 1; u.cargo = false; u.moving = false; u.mining = true; u.facing = 1; }
  else if (t < 9.6) { q = 1 - (t - 5.4) / 4.2; u.cargo = true; u.moving = true; u.mining = false; u.facing = -1; }
  else { q = 0; u.cargo = false; u.moving = false; u.mining = false; }
  u.x = start[0] + (end[0] - start[0]) * q;
  u.y = start[1] + (end[1] - start[1]) * q;
  u.travelTime += dt;
  return u;
}
