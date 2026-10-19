// The public daily prayer is a read-only step. Its recording marker remains Daily others.
// Persisted prayer snapshots and the local processor retain their six canonical sections.
export function prayerStep(position){return [{section:0},{section:1},{section:2},{section:2,world:true},{section:3},{section:4},{section:5}][(position%7+7)%7];}
