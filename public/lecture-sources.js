// Imports keep their original identity. An image has no recoverable stroke clock.
export const SOURCE_LIMITS = Object.freeze({
  document: 24 * 1024 * 1024,
  recording: 2 * 1024 * 1024 * 1024,
  range: 4 * 1024 * 1024,
});
export function sourceAppliesToLecture(source, lecture) {
  const s=source?.data,l=lecture?.data;
  if(!s||!l||!lecture.id)return false;
  if(source?.kind==='lecture-source')return s?.lectureId===lecture?.id;
  return source?.kind==='lecture-course-source'&&s?.courseId===l?.courseId&&
    (l.materialIds?.includes(source.id) ||
    /^\d{4}-\d{2}-\d{2}$/.test(s.fromDay??'')&&/^\d{4}-\d{2}-\d{2}$/.test(s.throughDay??'')&&
    l.lifeosDay>=s.fromDay&&l.lifeosDay<=s.throughDay);
}
export function driveId(value) {
  const text = String(value).trim();
  if (/^[-\w]{10,200}$/.test(text)) return text;
  const u = new URL(text);
  if (u.protocol !== "https:" || u.hostname !== "drive.google.com")
    throw Error("Use a Google Drive file link.");
  const id = u.pathname.match(/^\/file\/d\/([-\w]{10,200})(?:\/|$)/)?.[1];
  if (!id) throw Error("Use a Google Drive file link.");
  return id;
}
export function validateSource(metadata, role, owner) {
  if (!["notes", "slides", "recording"].includes(role))
    throw Error("Choose notes, slides or recording.");
  const types =
    role === "recording"
      ? [
          "video/mp4",
          "video/quicktime",
          "audio/mp4",
          "audio/mpeg",
          "audio/webm",
          "video/webm",
          "audio/ogg",
        ]
      : ["image/png", "image/jpeg", "application/pdf"];
  if (!types.includes(metadata.mimeType))
    throw Error(
      role === "slides"
        ? "Export this slide deck as PDF first."
        : "Unsupported source format.",
    );
  if (
    metadata.trashed ||
    metadata.shared !== false ||
    !metadata.owners?.some((o) => typeof owner === "string" && o.emailAddress === owner)
  )
    throw Error("Choose a private file owned by your LifeOS account.");
  if(!Number.isFinite(Date.parse(metadata.modifiedTime))||typeof metadata.md5Checksum!=='string'||!metadata.md5Checksum.length)throw Error('This file has no verifiable revision. Use a completed Drive upload.');
  const size = Number(metadata.size),
    limit =
      role === "recording" ? SOURCE_LIMITS.recording : SOURCE_LIMITS.document;
  if (!Number.isSafeInteger(size) || size <= 0 || size > limit)
    throw Error("This source exceeds the import size limit.");
  return {
    fileId: metadata.id,
    title: metadata.name,
    mimeType: metadata.mimeType,
    size,
    modifiedTime: metadata.modifiedTime,
    md5: metadata.md5Checksum || null,
    role,
    timing: "unmapped",
    durationMs: Number(metadata.videoMediaMetadata?.durationMillis) || null,
  };
}
export function sourceRange(header, size) {
  if (!header) return null;
  const m = header.match(/^bytes=(\d+)-(\d*)$/);
  if (!m) throw Error("Unsupported media byte range");
  const start = Number(m[1]),
    requested = m[2] ? Number(m[2]) : size - 1;
  if (!Number.isSafeInteger(start) || start >= size || requested < start)
    throw Error("Invalid media byte range");
  const end = Math.min(requested, size - 1, start + SOURCE_LIMITS.range - 1);
  return { start, end, length: end - start + 1 };
}
export function validateBackground(bg) {
  if (
    !bg ||
    Object.keys(bg).some(
      (k) =>
        ![
          "dataUrl",
          "sourceName",
          "sourceId",
          "sourcePage",
          "sourceHash",
          "crop",
          "reviewRegions",
        ].includes(k),
    )
  )
    throw Error("Invalid source background");
  if (
    typeof bg.dataUrl !== "string" ||
    bg.dataUrl.length > 480000 ||
    !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(bg.dataUrl)
  )
    throw Error("Source crop is too large");
  for (const key of ["sourceName", "sourceId", "sourceHash"])
    if (typeof bg[key] !== "string" || bg[key].length > 220)
      throw Error("Invalid source reference");
  if (
    !Number.isInteger(bg.sourcePage) ||
    bg.sourcePage < 1 ||
    bg.sourcePage > 2000
  )
    throw Error("Invalid source page");
  if (
    !Array.isArray(bg.crop) ||
    bg.crop.length !== 4 ||
    bg.crop.some((x) => !Number.isFinite(x) || x < 0 || x > 1) ||
    bg.crop[2] <= 0 ||
    bg.crop[3] <= 0 ||
    bg.crop[0] + bg.crop[2] > 1.00001 ||
    bg.crop[1] + bg.crop[3] > 1.00001
  )
    throw Error("Invalid source crop");
  if (bg.reviewRegions !== undefined) {
    if (!Array.isArray(bg.reviewRegions) || bg.reviewRegions.length > 100)
      throw Error("Invalid review regions");
    for (const r of bg.reviewRegions)
      if (
        !Array.isArray(r) ||
        r.length !== 4 ||
        r.some((x) => !Number.isFinite(x) || x < 0 || x > 1) ||
        r[2] <= 0 ||
        r[3] <= 0 ||
        r[0] + r[2] > 1.00001 ||
        r[1] + r[3] > 1.00001
      )
        throw Error("Invalid highlighted region");
  }
  return bg;
}
// Only invoked after the user confirms that yellow means "unclear" for this import.
// Detects colored areas, not handwriting, concepts or whether an answer is correct.
export function yellowReviewRegions({ data, width, height }) {
  const regions = [];
  let active = null,
    gap = 0;
  for (let y = 0; y < height; y++) {
    let lo = width,
      hi = -1,
      count = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      if (r > 170 && g > 130 && b < 180 && r > b * 1.25 && g > b * 1.2) {
        lo = Math.min(lo, x);
        hi = x;
        count++;
      }
    }
    if (count > width * 0.04) {
      if (!active) active = { lo, hi, start: y, end: y };
      else {
        active.lo = Math.min(active.lo, lo);
        active.hi = Math.max(active.hi, hi);
        active.end = y;
      }
      gap = 0;
    } else if (active && ++gap > Math.max(2, height * 0.002)) {
      if (active.end - active.start > 1)
        regions.push([
          active.lo / width,
          active.start / height,
          (active.hi - active.lo + 1) / width,
          (active.end - active.start + 1) / height,
        ]);
      active = null;
    }
  }
  if (active && active.end - active.start > 1)
    regions.push([
      active.lo / width,
      active.start / height,
      (active.hi - active.lo + 1) / width,
      (active.end - active.start + 1) / height,
    ]);
  return regions.slice(0, 100);
}
