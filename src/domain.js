export const POINT_COUNT = 7;

export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function normalizePoints(value) {
  if (!Array.isArray(value) || value.length !== POINT_COUNT) return null;
  if (!value.every((point) => typeof point === "string" && point.length <= 10_000)) return null;
  return value;
}

export function canComplete(points) {
  return points.length === POINT_COUNT && points.every((point) => point.trim().length > 0);
}
