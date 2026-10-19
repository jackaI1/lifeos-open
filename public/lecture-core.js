// Shared, deterministic lecture ink and audio timing. Raw samples never change.
import { validateBackground } from "./lecture-sources.js";
export const LECTURE = Object.freeze({
  leadInMs: 150,
  segmentMs: 60000,
  chunkMs: 5000,
  maxSegmentBytes: 8 * 1024 * 1024,
  uploadBytes: 4 * 1024 * 1024,
  maxOffsetMs: 12 * 3600000,
  pageWidth: 1000,
  pageHeight: 1400,
  maxPageBytes: 700000,
});
// Reserved vocabulary only. No processing job is launched by lecture capture.
export const LECTURE_PROCESSING_STATES = Object.freeze([
  "recorded",
  "transcription-queued",
  "transcribing",
  "transcribed",
  "outline-ready",
  "augmentation-ready",
  "failed",
]);
export const recordingApproved = (value) =>
  ["approved-by-instructor", "approved-by-accommodation", "approved-by-owner-confirmation"].includes(value);
export function currentCourseEvent(course, events, now = Date.now()) {
  const code = String(course.data?.code || "")
    .toUpperCase()
    .match(/^([A-Z]+)\s*(\d{3}[A-Z]?)$/);
  return (
    events
      .map((e) => e.data || e)
      .find((e) => {
        const title = String(e.title || e.summary || "").toUpperCase(),
          matches =
            e.courseId === course.id ||
            (!e.courseId &&
              code &&
              new RegExp("\\b" + code[1] + "\\s*" + code[2] + "\\b").test(
                title,
              ));
        return (
          matches &&
          Date.parse(e.start?.dateTime || e.start || e.startAt) <= now &&
          Date.parse(e.end?.dateTime || e.end || e.endAt) > now
        );
      }) || null
  );
}
const defaultClockNow=()=>performance.now();
export class LectureClock {
  constructor({
    now = defaultClockNow,
    eventTimestamps = now === defaultClockNow,
    base = 0,
    epochId = crypto.randomUUID(),
  } = {}) {
    this.now = now;this.eventTimestamps=eventTimestamps;
    this.origin = now();
    this.base = base;
    this.epochId = epochId;
    this.high = base;
  }
  offset() {
    return (this.high = Math.max(
      this.high,
      this.base + this.now() - this.origin,
    ));
  }
  eventOffset(timestamp){const current=this.now();const valid=this.eventTimestamps&&Number.isFinite(timestamp)&&timestamp<=current+100&&current-timestamp<60000;this.lastEventBasis=valid?'event-time':'callback-time';const value=this.base+Math.max(0,(valid?timestamp:current)-this.origin);this.high=Math.max(this.high,value);return value;}
  anchor() {
    return {
      epochId: this.epochId,
      offsetMs: this.offset(),
      wallAt: new Date().toISOString(),
    };
  }
}
export function samplePoint(event, rect, clock) {
  return {
    x: ((event.clientX - rect.left) * LECTURE.pageWidth) / rect.width,
    y: ((event.clientY - rect.top) * LECTURE.pageHeight) / rect.height,
    pressure: Math.min(
      1,
      Math.max(0, Number.isFinite(event.pressure) ? event.pressure : 0.5),
    ),
    tiltX: event.tiltX || 0,
    tiltY: event.tiltY || 0,
    offsetMs: clock.eventOffset?.(event.timeStamp)??clock.offset(),
  };
}
export function inkWidth(width, pressure) {
  return width * (0.45 + 0.85 * Math.min(1, Math.max(0, pressure)));
}
export function smoothPoints(points) {
  return points.map((p, i) =>
    i === 0 || i === points.length - 1
      ? { ...p }
      : {
          ...p,
          x: (points[i - 1].x + 2 * p.x + points[i + 1].x) / 4,
          y: (points[i - 1].y + 2 * p.y + points[i + 1].y) / 4,
        },
  );
}
export function strokeAudioTarget(stroke, clips, leadInMs = LECTURE.leadInMs) {
  const clip = clips.find(
    (c) => c.status === 'saved' && (stroke.audioSegmentId ? c.id === stroke.audioSegmentId : stroke.timingBasis === 'shared-clock' && c.epochId === stroke.epochId && stroke.startedAtOffsetMs >= c.startMs && stroke.startedAtOffsetMs <= c.endMs),
  );
  if (!clip) return null;
  const span = clip.endMs - clip.startMs;
  if (
    !(span > 0) ||
    stroke.startedAtOffsetMs < clip.startMs ||
    stroke.startedAtOffsetMs > clip.endMs
  )
    return null;
  const scale =
    Number.isFinite(clip.mediaDurationMs) && clip.mediaDurationMs > 0
      ? clip.mediaDurationMs / span
      : 1;
  return {
    clipId: clip.id,
    recordingId: clip.recordingId,
    seconds: Math.max(
      0,
      ((stroke.startedAtOffsetMs - clip.startMs - leadInMs) * scale) / 1000,
    ),
  };
}
export function validatePage(page) {
  const number = (v, min, max) => {
    if (!Number.isFinite(v) || v < min || v > max)
      throw new Error("Invalid ink coordinate or timestamp");
  };
  const fields = (obj, names) => {
    if (
      !obj ||
      typeof obj !== "object" ||
      Array.isArray(obj) ||
      Object.keys(obj).some((k) => !names.includes(k))
    )
      throw new Error("Unsupported note field");
  };
  fields(page, [
    "schemaVersion",
    "width",
    "height",
    "strokes",
    "epochs",
    "background",
    "attachments",
    "lined",
    "growthStep",
  ]);
  if (page.background) validateBackground(page.background);
  if (page.attachments !== undefined) {
    if (!Array.isArray(page.attachments) || page.attachments.length > 128) throw Error("This page already has 128 images.");
    const ids = new Set();
    for (const a of page.attachments) {
      fields(a, ["id", "x", "y", "width", "height", "background", "crop", "keying", "rotation"]);
      if (typeof a.id !== "string" || !/^[-\w]{1,100}$/.test(a.id) || ids.has(a.id)) throw Error("Invalid crop identity");
      ids.add(a.id);
      if(a.rotation!==undefined)number(a.rotation,-45,45);
      number(a.x, 0, LECTURE.pageWidth); number(a.y, 0, 1000000);
      number(a.width, 1, LECTURE.pageWidth); number(a.height, 1, 1000000);
      if (a.x + a.width > LECTURE.pageWidth || a.y + a.height > (page.height ?? LECTURE.pageHeight)) throw Error("Crop is outside the note page");
      if(a.crop!==undefined){if(!Array.isArray(a.crop)||a.crop.length!==4)throw Error("Invalid image crop");a.crop.forEach(n=>number(n,0,1));if(a.crop[2]<=0||a.crop[3]<=0||a.crop[0]+a.crop[2]>1.00001||a.crop[1]+a.crop[3]>1.00001)throw Error("Invalid image crop");}
      if(a.keying!==undefined){fields(a.keying,['color','threshold']);if(typeof a.keying.color!=='string'||!/^#[0-9a-f]{6}$/i.test(a.keying.color))throw Error('Invalid background colour');number(a.keying.threshold,0,150);}
      validateBackground(a.background);
    }
  }
  if(page.growthStep!=null)number(page.growthStep,200,500000);
  if(page.width!=null&&page.width!==LECTURE.pageWidth)throw Error("Invalid paper width");number(page.height??LECTURE.pageHeight,400,1000000);if(page.lined!=null&&typeof page.lined!=="boolean")throw Error("Invalid ruled paper setting");
  if (
    page?.schemaVersion !== 1 ||
    !Array.isArray(page.strokes) ||
    page.strokes.length > 1500
  )
    throw new Error("Invalid note page");
  if (page.epochs !== undefined) {
    if (!Array.isArray(page.epochs) || page.epochs.length > 1000)
      throw new Error("Too many recording clock epochs");
    for (const a of page.epochs) {
      fields(a, ["epochId", "offsetMs", "wallAt", "resumed", "discontinuity"]);
      if (
        typeof a.epochId !== "string" ||
        a.epochId.length > 100 ||
        !Number.isFinite(Date.parse(a.wallAt))
      )
        throw new Error("Invalid clock anchor");
      number(a.offsetMs, 0, LECTURE.maxOffsetMs);
      if (
        a.discontinuity != null &&
        (typeof a.discontinuity !== "string" || a.discontinuity.length > 150)
      )
        throw new Error("Invalid clock discontinuity");
    }
  }
  for (const s of page.strokes) {
    fields(s, [
      "id",
      "pageId",
      "epochId",
      "createdAt",
      "width",
      "startedAtOffsetMs",
      "endedAtOffsetMs",
      "audioSegmentId",
      "points",
      "hidden",
      "intent",
      "color",
      "highlightRegions",
      "highlightedStrokeIds",
      "timingBasis",
      "shape",
      "graph",
      "sourceStrokeId",
    ]);
    if (typeof s.pageId !== "string" || !/^\d{4}$/.test(s.pageId))
      throw new Error("Invalid stroke page");
    for (const p of s.points || [])
      fields(p, ["x", "y", "pressure", "tiltX", "tiltY", "offsetMs"]);
  }
  const ids = new Set();
  for (const s of page.strokes) {
    if (
      typeof s.id !== "string" ||
      s.id.length > 100 ||
      ids.has(s.id) ||
      !Array.isArray(s.points) ||
      !s.points.length ||
      s.points.length > 12000
    )
      throw new Error("Invalid stroke");
    ids.add(s.id);
    number(s.width, 0.5, 20);
    number(s.startedAtOffsetMs, 0, LECTURE.maxOffsetMs);
    number(s.endedAtOffsetMs, s.startedAtOffsetMs, LECTURE.maxOffsetMs);
    if (
      typeof s.epochId !== "string" ||
      s.epochId.length > 100 ||
      typeof s.createdAt !== "string" ||
      !Number.isFinite(Date.parse(s.createdAt))
    )
      throw new Error("Invalid stroke origin");
    if (
      s.audioSegmentId !== null &&
      (typeof s.audioSegmentId !== "string" || s.audioSegmentId.length > 100)
    )
      throw new Error("Invalid audio reference");
    let previous = s.startedAtOffsetMs;
    for (const p of s.points) {
      number(p.x, 0, LECTURE.pageWidth);
      number(p.y, 0, page.height??LECTURE.pageHeight);
      number(p.pressure, 0, 1);
      number(p.offsetMs, previous, s.endedAtOffsetMs);
      number(p.tiltX, -90, 90);
      number(p.tiltY, -90, 90);
      previous = p.offsetMs;
    }
    if(s.color!==undefined&&(typeof s.color!=='string'||!/^#[0-9a-f]{6}$/i.test(s.color)))throw Error('Invalid ink color');
    if(s.timingBasis!==undefined&&!['event-time','callback-time','shared-clock'].includes(s.timingBasis))throw Error('Invalid ink timing basis');
    if(s.sourceStrokeId!==undefined&&(typeof s.sourceStrokeId!=='string'||(typeof s.sourceStrokeId!=='string'||!s.sourceStrokeId||s.sourceStrokeId.length>100)))throw Error('Invalid original stroke');
    if(s.shape&&s.graph)throw Error('Choose one geometric annotation');
    if(s.shape||s.graph){const g=s.shape??s.graph;fields(g,s.shape?['type','from','to']:['from','to','dimensions','negatives','spacing']);for(const p of [g.from,g.to]){fields(p,['x','y']);number(p.x,0,LECTURE.pageWidth);number(p.y,0,page.height??LECTURE.pageHeight);}if(s.shape&&!['line','ellipse','rectangle'].includes(g.type))throw Error('Invalid held shape');if(s.graph){if(![1,2,3].includes(g.dimensions)||typeof g.negatives!=='boolean')throw Error('Invalid graph options');number(g.spacing,12,200);}}
    if(s.highlightRegions!==undefined){if(!['unclear','unfinished'].includes(s.intent)||!Array.isArray(s.highlightRegions)||s.highlightRegions.length>64)throw Error('Invalid highlight regions');for(const polygon of s.highlightRegions){if(!Array.isArray(polygon)||polygon.length<3||polygon.length>64)throw Error('Invalid highlight polygon');for(const p of polygon){fields(p,['x','y']);number(p.x,0,1000);number(p.y,0,page.height??LECTURE.pageHeight);}}}
    if(s.highlightedStrokeIds!==undefined&&(!Array.isArray(s.highlightedStrokeIds)||s.highlightedStrokeIds.length>10000||s.highlightedStrokeIds.some(id=>typeof id!=='string'||!id||id.length>100)))throw Error('Invalid highlight targets');
    if (s.hidden !== undefined && typeof s.hidden !== "boolean")
      throw new Error("Invalid ink visibility");
    if (
      s.intent !== undefined &&
      !["ink", "unclear", "unfinished"].includes(s.intent)
    )
      throw new Error("Invalid note intent");
  }
  if (
    new TextEncoder().encode(JSON.stringify(page)).length > LECTURE.maxPageBytes
  )
    throw new Error("This page is full. Add a new page.");
  return page;
}
export function hitStroke(strokes, x, y, tolerance = 12) {
  return [...strokes].reverse().find(
    (s) =>
      !s.hidden &&
      s.points.some((p, i) => {
        const q = s.points[Math.max(0, i - 1)],
          dx = p.x - q.x,
          dy = p.y - q.y,
          t = Math.max(
            0,
            Math.min(
              1,
              ((x - q.x) * dx + (y - q.y) * dy) / (dx * dx + dy * dy || 1),
            ),
          );
        return Math.hypot(x - q.x - t * dx, y - q.y - t * dy) <= tolerance;
      }),
  );
}
