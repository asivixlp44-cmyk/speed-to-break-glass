// The shaders' shared clock: uNow is seconds since EPOCH on the server's clock (so every client's
// animations of the same moment line up), uNight how dark it is (0 day .. 1 night).
export const CU = { uNow: { value: 0 }, uNight: { value: 0 } };
export let EPOCH = 0;
export function setEpoch(ms) { EPOCH = ms; }
// a server time (ms) on the shaders' clock
export const rel = (ms) => (ms - EPOCH) / 1000;
