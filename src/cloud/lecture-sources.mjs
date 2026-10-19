import { AppError } from "../shared/errors.mjs";
import { googleFetch, privateFile } from "./google.mjs";
import { digest } from "./store.mjs";
import {
  validateSource,
  sourceRange,
  SOURCE_LIMITS,
  driveId,
  sourceAppliesToLecture,
} from "../../public/lecture-sources.js";
import * as v from "../server/validation.mjs";
export async function sourceMetadata(env, fileId, role) {
  const fields =
    "id,name,mimeType,size,modifiedTime,md5Checksum,shared,trashed,owners(emailAddress),videoMediaMetadata";
  const m = await (
    await googleFetch(
      env,
      "https://www.googleapis.com/drive/v3/files/" +
        driveId(fileId) +
        "?fields=" +
        encodeURIComponent(fields),
    )
  ).json();
  try {
    return validateSource(m, role, env.ALLOWED_EMAIL);
  } catch (e) {
    throw new AppError(e.message, 403);
  }
}
export async function lectureSourceRoute({
  store,
  env,
  config,
  req,
  path,
  id,
  lecture,
  part,
  content,
  json,
  change,
  rows,
}) {
  if(lecture?.id!==id)throw new AppError("Lecture source not found",404);
  if(req.method==='GET'&&part==='catalog'){const items=(await rows(store,'lecture-course-source',lecture.data.courseId+'-',201)).filter(r=>r.data.courseId===lecture.data.courseId&&['slides','notes'].includes(r.data.role)&&r.data.mimeType==='application/pdf');return Response.json({items:items.slice(0,200),partial:items.length>200});}
  if(req.method==='POST'&&part==='course'){
    const b=await json(req);v.exactFields(b,['sourceId','mutationId','pageRange']);v.identifier(b.sourceId);v.mutationId(b.mutationId);const source=await store.get('lecture-course-source',b.sourceId);if(!source||source.kind!=='lecture-course-source'||source.data.courseId!==lecture.data.courseId||!['slides','notes'].includes(source.data.role)||source.data.mimeType!=='application/pdf')throw new AppError('Choose a saved slide deck from this course.',403);
    if(b.pageRange){v.exactFields(b.pageRange,['from','through']);for(const x of Object.values(b.pageRange)){v.number(x,1,2000);if(!Number.isInteger(x))throw new AppError('Use whole slide page numbers');}if(b.pageRange.through<b.pageRange.from)throw new AppError('The last slide must follow the first.');}
    const fingerprint={path,b},prior=await store.mutation(b.mutationId,await digest(JSON.stringify(fingerprint)));if(prior)return Response.json(prior);const key=id+'-s-'+(await digest('course:'+source.id+(b.pageRange?':'+b.pageRange.from+':'+b.pageRange.through:''))).slice(0,20),old=await store.get('lecture-source',key);if(old)return Response.json({item:old});if((await rows(store,'lecture-source',id+'-s-',51)).length>=50)throw new AppError('This lecture has reached 50 sources.');const c=change('lecture-source',key,null,{...source.data,lectureId:id,sourceRecordId:source.id,...(b.pageRange?{pageRange:b.pageRange}:{}),importedAt:new Date().toISOString()});return Response.json(await store.commit({id:b.mutationId,fingerprint,changes:[c],result:{item:c.after}}));
  }
  if (req.method === "GET" && part === "list") {
    const items=await rows(store,"lecture-source",id+"-s-",51);
    const library=await rows(store,"lecture-course-source",lecture.data.courseId+"-",101);
    for(const key of (lecture.data.materialIds??[]).slice(0,20)){
      if(!library.some(s=>s.id===key)){const selected=await store.get('lecture-course-source',key);if(selected)library.push(selected);}
    }
    return Response.json({items:[...items,...library.filter(r=>sourceAppliesToLecture(r,lecture)&&!items.some(i=>i.data.fileId===r.data.fileId))]});
  }
  if (req.method === "POST" && part === "drive") {
    const b = await json(req);
    v.exactFields(b, ["fileId", "role", "mutationId"]);
    v.mutationId(b.mutationId);
    let fileId;
    try {
      fileId = driveId(b.fileId);
    } catch {
      throw new AppError("Use a Google Drive file link.");
    }
    const fp = { path, b },
      cached = await store.mutation(
        b.mutationId,
        await digest(JSON.stringify(fp)),
      );
    if (cached) return Response.json(cached);
    const data = await sourceMetadata(env, fileId, b.role),
      key = id + "-s-" + (await digest(b.role + ":" + fileId)).slice(0, 20),
      old = await store.get("lecture-source", key);
    if (old) {
      if (
        old.data.md5 !== data.md5 ||
        old.data.modifiedTime !== data.modifiedTime
      )
        throw new AppError(
          "The original changed. Keep the existing source and import a separate copy.",
          409,
        );
      return Response.json({ item: old });
    }
    if ((await rows(store, "lecture-source", id + "-s-", 51)).length >= 50)
      throw new AppError("This lecture has reached 50 sources.");
    const c = change("lecture-source", key, null, {
      ...data,
      lectureId: id,
      importedAt: new Date().toISOString(),
    });
    const changes = [c];
    if (b.role === "recording")
      changes.push(
        change("lecture", id, lecture, {
          ...lecture.data,
          importedRecordingCount:
            (lecture.data.importedRecordingCount || 0) + 1,
        }),
      );
    return Response.json(
      await store.commit({
        id: b.mutationId,
        fingerprint: fp,
        changes,
        result: { item: c.after },
      }),
    );
  }
  if (req.method !== "GET" || !content)
    throw new AppError("Source route not found", 404);
  const source = await store.get("lecture-source", part) ?? await store.get("lecture-course-source",part);
  if (!sourceAppliesToLecture(source,lecture))
    throw new AppError("Lecture source not found", 404);
  const data=source.data;let resolvedFileId=data.fileId,current;try{current=await sourceMetadata(env,data.fileId,data.role);}catch(error){if(data.role!=='slides')throw error;}
  if(!current||current.md5!==data.md5||current.modifiedTime!==data.modifiedTime||current.size!==data.size){
    // A preserved content-identical snapshot keeps old source links readable after an append.
    const key='lecture-deck:'+await digest((data.originFileId??data.fileId)+':'+data.md5),receipt=store.sql?await store.sql('SELECT * FROM private_objects WHERE object_key=? AND verified=1',key).first():null;
    if(data.role!=='slides'||!receipt||receipt.folder_id!==config?.driveFolders?.uploads)throw new AppError('The original source changed. Reimport a separate copy before using it.',409);
    const archived=await privateFile(env,receipt.drive_id,config.driveFolders.uploads);if(archived.md5Checksum!==data.md5||Number(archived.size)!==data.size)throw new AppError('The preserved deck no longer matches its source',409);resolvedFileId=receipt.drive_id;
  }
  let range;
  try {
    range = sourceRange(
      req.headers.get("range") ||
        (data.role === "recording" ? "bytes=0-" : null),
      data.size,
    );
  } catch (e) {
    throw new AppError(e.message, 416);
  }
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "Content-Type": data.mimeType,
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  });
  const upstream = await googleFetch(
    env,
    "https://www.googleapis.com/drive/v3/files/" + resolvedFileId + "?alt=media",
    { headers: range ? { Range: `bytes=${range.start}-${range.end}` } : {} },
  );
  if (
    range &&
    (upstream.status !== 206 ||
      upstream.headers.get("content-range") !==
        `bytes ${range.start}-${range.end}/${data.size}`)
  ) {
    await upstream.body?.cancel();
    throw new AppError(
      "Provider did not return the requested media range",
      502,
    );
  }
  const length = range?.length ?? data.size;
  if (length > (range ? SOURCE_LIMITS.range : SOURCE_LIMITS.document)) {
    await upstream.body?.cancel();
    throw new AppError("Source response exceeds its limit", 413);
  }
  // Enforce the response bound even if an upstream server misreports Content-Length.
  let read = 0;
  const body = upstream.body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        read += chunk.byteLength;
        if (read > length) throw Error("Source response exceeded bound");
        controller.enqueue(chunk);
      },
      flush() {
        if (read !== length) throw Error("Source response was incomplete");
      },
    }),
  );
  headers.set("Content-Length", String(length));
  if (range)
    headers.set(
      "Content-Range",
      `bytes ${range.start}-${range.end}/${data.size}`,
    );
  return new Response(body, { status: range ? 206 : 200, headers });
}
