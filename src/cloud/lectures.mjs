import {lecturePhotoRoute} from './lecture-photos.mjs';
import {lectureCaptureRoute} from './lecture-capture.mjs';
import {snapshotDeck} from './lecture-deck.mjs';
import {lectureStudyRoute} from './lecture-study.mjs';
import {lectureLayoutRoute} from './lecture-layout.mjs';
import {NOTEBOOK_MAX_PAGES} from '../../public/lecture-layout.js';
import {lectureInkRoute} from './lecture-ink.mjs';
import { AppError } from "../shared/errors.mjs";
import { lectureSourceRoute } from "./lecture-sources.mjs";
import * as v from "../server/validation.mjs";
import { digest } from "./store.mjs";
import { boundedBytes, uploadChunk } from "./files.mjs";
import { privateObject } from "./objects.mjs";
import { privateFile, googleFetch } from "./google.mjs";
import { lifeosDay } from "../../public/lifeos-day.js";
import { sourceAppliesToLecture } from "../../public/lecture-sources.js";
import {
  recordingApproved,
  validatePage,
  LECTURE,
} from "../../public/lecture-core.js";
const response = Response.json.bind(Response);
const unpack = (r) => ({
  id: r.id,
  kind: r.kind,
  data: JSON.parse(r.data),
  version: r.version,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const change = (kind, id, before, data) => {
  const now = new Date().toISOString();
  return {
    kind,
    id,
    before,
    auditId: crypto.randomUUID(),
    actor: "owner-lecture",
    after: {
      id,
      kind,
      data,
      version: (before?.version ?? 0) + 1,
      createdAt: before?.createdAt ?? now,
      updatedAt: now,
    },
  };
};
async function rows(store, kind, prefix, limit = 501) {
  return (
    await store
      .sql(
        "SELECT * FROM records WHERE kind=? AND id>=? AND id<? ORDER BY id LIMIT ?",
        kind,
        prefix,
        prefix + "~",
        limit,
      )
      .all()
  ).results.map(unpack);
}
async function json(req) {
  if (!req.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError("JSON required", 415);
  try {
    return v.object(
      JSON.parse(new TextDecoder().decode(await boundedBytes(req, 800000))),
    );
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("Invalid lecture data");
  }
}
export async function lectureRoute({
  store,
  env,
  config,
  req,
  path,
  writeObject = privateObject,
}) {
  if (
    !path.startsWith("/api/lectures") &&
    !path.startsWith("/api/lecture-permission/") &&
    path !== "/api/lecture-lessons"
  )
    return null;
  const permissionMatch = path.match(/^\/api\/lecture-permission\/([-\w]+)$/);
  if (permissionMatch) {
    const courseId = v.identifier(permissionMatch[1]);
    if (!(await store.get("course", courseId)))
      throw new AppError("Course not found", 404);
    const old = await store.get("lecture-permission", courseId);
    if (req.method === "GET") return response({ item: old });
    if (req.method !== "PUT") throw new AppError("Method not allowed", 405);
    const b = await json(req);
    v.exactFields(b, ["state", "version", "mutationId"]);
    v.enumValue(b.state, [
      "unknown",
      "approved-by-instructor",
      "approved-by-accommodation",
      "approved-by-owner-confirmation",
      "not-approved",
    ]);
    const fp = { path, b };
    const cached = await store.mutation(
      v.mutationId(b.mutationId),
      await digest(JSON.stringify(fp)),
    );
    if (cached) return response(cached);
    if (v.version(b.version) !== (old?.version ?? 0))
      throw new AppError("Permission changed. Reload before saving.", 409);
    const c = change("lecture-permission", courseId, old, {
      courseId,
      state: b.state,
      confirmedAt: new Date().toISOString(),
    });
    return response(
      await store.commit({
        id: b.mutationId,
        fingerprint: fp,
        changes: [c],
        result: { item: c.after },
      }),
    );
  }
  const url = new URL(req.url);
  if (path === "/api/lecture-lessons") {
    if (req.method !== "GET") throw new AppError("Method not allowed", 405);
    const courseId = v.identifier(url.searchParams.get("course"));
    if (!(await store.get("course", courseId))) throw new AppError("Course not found", 404);
    const found = await rows(store, "course-lesson", courseId + "-lesson-", 201);
    return response({items: found.slice(0, 200).filter(r => r.data.courseId === courseId),
      partial: found.length > 200, library: await store.get("course-library", courseId)});
  }
  if (path === "/api/lectures") {
    if (req.method === "GET") {
      const courseId = v.identifier(url.searchParams.get("course"));
      if (!(await store.get("course", courseId)))
        throw new AppError("Course not found", 404);
      const prefix = "lc-" + (await digest(courseId)).slice(0, 16) + "-";
      const after = url.searchParams.get("after") || prefix;
      if (
        after !== prefix &&
        (!after.startsWith(prefix) || !/^[-\w]{1,100}$/.test(after))
      )
        throw new AppError("Invalid lecture cursor");
      const found = (
        await store
          .sql(
            "SELECT * FROM records WHERE kind=? AND id>? AND id<? ORDER BY id LIMIT 101",
            "lecture",
            after,
            prefix + "~",
          )
          .all()
      ).results.map(unpack);
      return response({
        items: found.slice(0, 100),
        nextCursor: found.length > 100 ? found[99].id : null,
      });
    }
    if (req.method !== "POST") throw new AppError("Method not allowed", 405);
    const b = await json(req);
    v.exactFields(b, [
      "courseId",
      "title",
      "startedAt",
      "mutationId",
      "synthetic",
      "lessonId",
    ]);
    const courseId = v.identifier(b.courseId),
      course = await store.get("course", courseId);
    if (!course) throw new AppError("Select an existing course", 404);
    const prior = await store.mutation(v.mutationId(b.mutationId), await digest(JSON.stringify({path,b})));
    if(prior)return response(prior);
    const lesson = b.lessonId ? await store.get("course-lesson", v.identifier(b.lessonId)) : null;
    if (b.lessonId && (!lesson || lesson.data.courseId !== courseId))
      throw new AppError("Choose a lesson from this course", 409);
    const materialIds = lesson?.data.sourceIds ?? [];
    if (!Array.isArray(materialIds) || materialIds.length > 20) throw new AppError("Invalid lesson materials", 409);
    const sources = await Promise.all(materialIds.map(sourceId => store.get("lecture-course-source", v.identifier(sourceId))));
    if (sources.some(s => !s || s.data.courseId !== courseId)) throw new AppError("Lesson materials need refresh", 409);
    if (b.synthetic && config.environment !== "beta")
      throw new AppError("Synthetic lectures belong in beta", 403);
    v.text(b.title, 200, { required: true });
    if (!Number.isFinite(Date.parse(b.startedAt)))
      throw new AppError("Invalid start time");
    const id =
      "lc-" +
      (await digest(courseId)).slice(0, 16) +
      "-" +
      v
        .mutationId(b.mutationId)
        .replace(/[^\w-]/g, "")
        .slice(0, 40);
    const c = change("lecture", id, null, {
      courseId,
      term: course.data.term ?? null,
      title: b.title,
      lifeosDay: lifeosDay(b.startedAt),
      startedAt: b.startedAt,
      endedAt: null,
      recordingStatus: "notes-only",
      savedSegments: 0,
      materialIds,
      lessonId: lesson?.id ?? null,
      ...(lesson?.data.pageRange?{lessonPageRange:lesson.data.pageRange}:{}),
      noteDocumentId: id,
      recordingId: id,
      transcriptStatus: "not-requested",
      processingStatus: "recorded",
      lastOffsetMs: 0,
      ...(b.synthetic ? { synthetic: true, testRunId: b.mutationId } : {}),
    });
    return response(
      await store.commit({
        id: b.mutationId,
        fingerprint: { path, b },
        reads: [course,lesson,...sources].filter(Boolean).map(r=>({kind:r.kind,id:r.id,version:r.version})),
        changes: [c],
        result: { item: c.after },
      }),
    );
  }
  const capturePath=path.match(/^\/api\/lectures\/([-\w]+)\/capture$/);if(capturePath)return lectureCaptureRoute({store,req,id:capturePath[1],json,change});
  const studyPath=path.match(/^\/api\/lectures\/([-\w]+)\/study(?:\/.*)?$/);if(studyPath)return lectureStudyRoute({store,req,id:studyPath[1],json});
  const layoutPath=path.match(/^\/api\/lectures\/([-\w]+)\/layout$/);if(layoutPath)return lectureLayoutRoute({store,req,id:layoutPath[1],json,change});
  const inkPath=path.match(/^\/api\/lectures\/([-\w]+)\/pages\/(\d{4})\/ink(?:\/(base|chunks)(?:\/(\d+))?)?$/);
  if(inkPath){const lecture=await store.get('lecture',v.identifier(inkPath[1]));if(!lecture)throw new AppError('Lecture not found',404);return lectureInkRoute({store,env,config,req,lecture,pageId:inkPath[2],part:inkPath[3],sequence:inkPath[4],json,change,writeObject});}
  const photoPath=path.match(/^\/api\/lectures\/([-\w]+)\/photos(?:\/([-\w]+))?$/);if(photoPath){const lecture=await store.get('lecture',v.identifier(photoPath[1]));if(!lecture)throw new AppError('Lecture not found',404);return lecturePhotoRoute({store,env,config,req,lecture,part:photoPath[2],json,change,writeObject});}
  const m = path.match(
    /^\/api\/lectures\/([-\w]+)(?:\/(pages|clips|sources)\/([-\w]+)(?:\/(\d+))?)?$/,
  );
  if (!m) throw new AppError("Lecture route not found", 404);
  const id = v.identifier(m[1]),
    lecture = await store.get("lecture", id);
  if (!lecture) throw new AppError("Lecture not found", 404);
  if(m[2]==='sources'&&m[3]==='snapshot'&&req.method==='POST')return response(await snapshotDeck({store,env,config,lecture,b:await json(req),change}));
  if(m[2]==='sources'&&m[3]==='range'&&req.method==='POST'){const b=await json(req);v.exactFields(b,['sourceId','pageRange','mutationId']);v.identifier(b.sourceId);const source=await store.get('lecture-source',b.sourceId);if(source?.data.lectureId!==id)throw new AppError('Deck belongs to another lecture',403);v.exactFields(b.pageRange,['from','through']);if(!Number.isInteger(b.pageRange.from)||!Number.isInteger(b.pageRange.through)||b.pageRange.from<1||b.pageRange.through<b.pageRange.from||b.pageRange.through>2000)throw new AppError('Invalid slide range');const c=change(source.kind,source.id,source,{...source.data,pageRange:b.pageRange});return response(await store.commit({id:v.mutationId(b.mutationId),fingerprint:{path,b},changes:[c],result:{item:c.after}}));}
  if (m[2] === "sources")
    return lectureSourceRoute({
      store,
      env,
      config,
      req,
      path,
      id,
      lecture,
      part: m[3],
      content: m[4] === "0",
      json,
      change,
      rows,
    });
  if (!m[2] && req.method === "GET") {
    const pages = await rows(store, "lecture-page", id + "-p-", NOTEBOOK_MAX_PAGES+1),
      clips = await rows(store, "lecture-clip", id + "-a-", 501);
    return response({
      item: lecture,
      transcript:(await store.get('lecture-transcript',id))?.data??null,
      pages,
      clips,
      permission:
        (await store.get("lecture-permission", lecture.data.courseId))?.data
          .state ?? "unknown",
    });
  }
  if (m[2] === "clips" && m[4] && req.method === "POST") {
    const clip = await store.get(
      "lecture-clip",
      id + "-a-" + v.identifier(m[3]),
    );
    if (!clip) throw new AppError("Register this audio segment first", 409);
    if (clip.data.status === "saved")
      throw new AppError("Segment already saved", 409);
    if (Number(m[4]) > 1) throw new AppError("Audio segment is too large", 413);
    return uploadChunk({
      store,
      env,
      config,
      req,
      sid: clip.data.recordingId,
      index: Number(m[4]),
      maxBytes: LECTURE.uploadBytes,
    });
  }
  if (m[2] === "pages" && req.method === "GET") {
    const page = await store.get(
      "lecture-page",
      id + "-p-" + v.identifier(m[3]),
    );
    if (!page) throw new AppError("Page not found", 404);
    if(page.data.inkFormat==='patches-v1')throw new AppError("Reload LifeOS to open this updated notebook. Your notes are preserved.",409,"ink-client-update");
    const object = await store
      .sql(
        "SELECT * FROM private_objects WHERE object_key=? AND verified=1",
        page.data.objectKey,
      )
      .first();
    if (!object || object.folder_id !== config.driveFolders.uploads)
      throw new AppError("Private page unavailable", 404);
    await privateFile(env, object.drive_id, object.folder_id);
    const bytes = await boundedBytes(
      await googleFetch(
        env,
        `https://www.googleapis.com/drive/v3/files/${object.drive_id}?alt=media`,
      ),
      LECTURE.maxPageBytes,
    );
    if ((await digest(bytes)) !== object.sha256)
      throw new AppError("Note integrity check failed", 503);
    return new Response(bytes, {
      headers: { "Content-Type": "application/json" },
    });
  }
  const b = await json(req),
    mutationId = v.mutationId(b.mutationId),
    fingerprint = { path, b };
  const cached = await store.mutation(
    mutationId,
    await digest(JSON.stringify(fingerprint)),
  );
  if (cached) return response(cached);
  if (!m[2] && req.method === "PUT") {
    v.exactFields(b, [
      "mutationId",
      "version",
      "endedAt",
      "lastOffsetMs",
      "expectedSegments",
      "localRecovery",
    ]);
    if (v.version(b.version) !== lecture.version)
      throw new AppError("Lecture changed on another device", 409);
    v.number(b.lastOffsetMs, lecture.data.lastOffsetMs, LECTURE.maxOffsetMs);
    if (b.endedAt !== null && !Number.isFinite(Date.parse(b.endedAt)))
      throw new AppError("Invalid end time");
    const expectedSegments =
      b.expectedSegments ?? lecture.data.savedSegments ?? 0;
    if (
      !Number.isInteger(expectedSegments) ||
      expectedSegments < 0 ||
      expectedSegments > 500
    )
      throw new AppError("Invalid audio segment count");
    if (b.localRecovery !== undefined) v.boolean(b.localRecovery);
    const c = change("lecture", id, lecture, {
      ...lecture.data,
      endedAt: b.endedAt,
      lastOffsetMs: b.lastOffsetMs,
      expectedSegments,
      localRecovery: b.localRecovery === true,
      recordingStatus: !expectedSegments
        ? "notes-only"
        : b.localRecovery
          ? "partial"
          : (lecture.data.savedSegments ?? 0) >= expectedSegments
            ? "available"
            : "pending",
    });
    return response(
      await store.commit({
        id: mutationId,
        fingerprint,
        changes: [c],
        result: { item: c.after },
      }),
    );
  }
  if (m[2] === "pages" && req.method === "PUT") {
    v.exactFields(b, ["mutationId", "version", "page"]);
    if (!/^\d{4}$/.test(m[3]) || Number(m[3]) > NOTEBOOK_MAX_PAGES)
      throw new AppError("Invalid page number");
    try {
      validatePage(b.page);
      if (b.page.strokes.some((s) => s.pageId !== m[3]))
        throw new Error("Stroke belongs to a different page");
    } catch (e) {
      throw new AppError(e.message);
    }
    for (const background of [b.page.background, ...(b.page.attachments ?? []).map(a => a.background)].filter(Boolean)) {
      const source = await store.get(
        "lecture-source",
        background.sourceId,
      ) ?? await store.get("lecture-course-source",background.sourceId);
      if (
        !source ||
        !sourceAppliesToLecture(source,lecture) ||
        !["notes", "slides"].includes(source.data.role)
      )
        throw new AppError(
          "Attach this note source to the same lecture first.",
          409,
        );
    }
    const key = id + "-p-" + m[3],
      old = await store.get("lecture-page", key);
    if(old?.data.inkFormat==='patches-v1')throw new AppError("Reload LifeOS before editing this notebook. Export any unsent local ink first.",409,"ink-client-update");
    if (v.version(b.version) !== (old?.version ?? 0))
      throw new AppError(
        "This page changed on another device. Export your local notes before resolving.",
        409,
      );
    const content = JSON.stringify(b.page),
      objectKey = "lecture-page:" + key + ":" + (await digest(content));
    await writeObject({
      store,
      env,
      folder: config.driveFolders.uploads,
      key: objectKey,
      name: key + ".json",
      mime: "application/json",
      content,
    });
    const lastOffsetMs = Math.max(
      0,
      ...b.page.strokes.map((s) => s.endedAtOffsetMs),
    );
    const c = change("lecture-page", key, old, {
      lectureId: id,
      pageId: m[3],
      objectKey,
      sha256: await digest(content),
      strokes: b.page.strokes.length,
      lastOffsetMs,
      ...(b.page.background ? {sourceBackground:{sourceId:b.page.background.sourceId,sourceHash:b.page.background.sourceHash,sourcePage:b.page.background.sourcePage,crop:b.page.background.crop}} : {}),
    });
    return response(
      await store.commit({
        id: mutationId,
        fingerprint,
        changes: [c],
        result: { item: c.after, saved: true },
      }),
    );
  }
  if (m[2] === "clips" && req.method === "POST") {
    v.exactFields(b, [
      "mutationId",
      "action",
      "startMs",
      "endMs",
      "wallAt",
      "epochId",
      "mimeType",
      "chunks",
      "mediaDurationMs",
    ]);
    const suffix = v.identifier(m[3]);
    if (!/^\d{4}$/.test(suffix) || Number(suffix) > 500)
      throw new AppError("Invalid segment number");
    const key = id + "-a-" + suffix,
      old = await store.get("lecture-clip", key);
    if (b.action === "register") {
      if (old) {
        if (
          old.data.epochId !== b.epochId ||
          old.data.startMs !== b.startMs ||
          old.data.mimeType !== b.mimeType
        )
          throw new AppError(
            "This segment identity belongs to another recording. Local audio is retained.",
            409,
          );
        return response({ item: old });
      }
      const permission = await store.get(
        "lecture-permission",
        lecture.data.courseId,
      );
      if (!recordingApproved(permission?.data.state))
        throw new AppError(
          "Recording permission is required. Your local audio remains on this device.",
          403,
        );
      v.number(b.startMs, 0, LECTURE.maxOffsetMs);
      if (!Number.isFinite(Date.parse(b.wallAt)))
        throw new AppError("Recording wall-clock anchor required");
      v.text(b.epochId, 100, { required: true });
      v.text(b.mimeType, 120);
      if (
        !/^audio\/(webm|mp4|ogg)(?:;\s*codecs="?[-\w., ]+"?)?$/.test(b.mimeType)
      )
        throw new AppError("Unsupported lecture audio format");
      const c = change("lecture-clip", key, null, {
        lectureId: id,
        id: suffix,
        recordingId: key,
        startMs: b.startMs,
        wallAt: b.wallAt,
        epochId: b.epochId,
        mimeType: b.mimeType,
        status: "uploading",
        permission: permission.data.state,
      });
      return response(
        await store.commit({
          id: mutationId,
          fingerprint,
          reads: [
            {
              kind: permission.kind,
              id: permission.id,
              version: permission.version,
            },
          ],
          changes: [c],
          result: { item: c.after },
        }),
      );
    }
    if (b.action !== "finalize" || !old)
      throw new AppError("Audio segment not registered", 409);
    if (old.data.status === "saved")
      return response({ item: old, saved: true });
    v.number(b.endMs, old.data.startMs, LECTURE.maxOffsetMs);
    if (!Number.isInteger(b.chunks) || b.chunks < 1 || b.chunks > 2)
      throw new AppError("Invalid audio chunk count");
    if (b.mediaDurationMs != null) v.number(b.mediaDurationMs, 1, 3600000);
    const chunks = (
      await store
        .sql(
          "SELECT * FROM chunks WHERE session_id=? ORDER BY chunk_index LIMIT 3",
          key,
        )
        .all()
    ).results;
    if (
      chunks.length !== b.chunks ||
      chunks.some((c, i) => c.chunk_index !== i) ||
      chunks.reduce((n, c) => n + c.size, 0) > LECTURE.maxSegmentBytes
    )
      throw new AppError("Audio has not finished saving", 409);
    const mime = old.data.mimeType.split(";")[0];
    if (chunks.some((c) => c.mime_type !== mime))
      throw new AppError("Audio format mismatch");
    const clip = change("lecture-clip", key, old, {
        ...old.data,
        status: "saved",
        endMs: b.endMs,
        mediaDurationMs: b.mediaDurationMs ?? null,
      }),
      manifest = change("upload-manifest", key, null, {
        title: "Lecture audio " + suffix,
        cloudChunks: true,
        mimeType: mime,
        totalChunks: b.chunks,
        totalSize: chunks.reduce((n, c) => n + c.size, 0),
        checksum: await digest(chunks.map((c) => c.sha256).join("")),
        checksumFormat: "ordered-sha256-manifest-v1",
        lectureId: id,
      });
    const updated = change("lecture", id, lecture, {
      ...lecture.data,
      savedSegments: (lecture.data.savedSegments ?? 0) + 1,
      recordingStatus: lecture.data.localRecovery
        ? "partial"
        : lecture.data.expectedSegments > (lecture.data.savedSegments ?? 0) + 1
          ? "pending"
          : "available",
      lastOffsetMs: Math.max(lecture.data.lastOffsetMs, b.endMs),
    });
    return response(
      await store.commit({
        id: mutationId,
        fingerprint,
        changes: [clip, manifest, updated],
        result: { item: clip.after, saved: true },
      }),
    );
  }
  throw new AppError("Method not allowed", 405);
}
