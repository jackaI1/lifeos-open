import {confirmLectureFinish} from '../lecture-finish-control.js';
import {editableLectureStore} from '../lecture-edit-store.js';
import {persistentLecture,rememberLiveNote,queueLectureSync,getLectureFinisher} from '../lecture-session.js';
import {openCourseDeckPicker} from '../lecture-course-picker.js';
import {lassoSelection,selectionBounds,transformSelection,constrainSelection} from '../lecture-lasso.js';
import {lectureSelectionEditor} from '../lecture-selection-editor.js';
import {pullLectureUpdate,validLectureResume} from '../lecture-update.js';
import {lectureImageEditor} from '../lecture-image-editor.js';
import {BackgroundImageCache} from '../lecture-image-background.js';
import {imagePlacement,drawNoteImage} from '../lecture-images.js';
import {trashEntryButton} from '../deleted.js';
import {openLectureTutor} from '../lecture-tutor-window.js';
import {chooseLecturePhoto,pasteLecturePhoto,pastedLectureImage,saveLecturePhoto,flushLecturePhotos,readLecturePhoto,photoBackground,showLecturePhotos} from '../lecture-photos.js';
import {growBlankPage,splitAcrossPages,undoInsertedPages} from '../lecture-editing.js';
import {showLectureReadiness} from '../lecture-readiness.js';
import {cachedLectureDeck} from '../lecture-deck-cache.js';
import {mountPhoneRecorder} from '../lecture-phone.js';
import {connectLectureClock,ownsLectureCapture} from '../lecture-capture-link.js';
import {mountStudyPane} from '../lecture-study-pane.js';
import {mergeStudyMarks} from '../lecture-study.js';
import {microphoneCheck} from '../lecture-mic-check.js';
import {checkDeckUpdates} from '../lecture-deck-updates.js';
import {mountAssistant} from '../assistant-chat.js';
import {ShapeHold,strokeNear,eraseFragments,PAPER_LINE_SPACING} from '../lecture-tools.js';
import {paperBottom} from '../lecture-paper.js';
import {NotebookRenderer} from '../lecture-notebook-renderer.js';
import {notebookLayout,editNotebook,visibleNotebook,notebookOffsets,NOTEBOOK_MAX_PAGES} from '../lecture-layout.js';
import {LectureLayoutJournal} from '../lecture-layout-journal.js';
import {dragSchedule} from '../schedule-edit.js';
import {LectureInkJournal} from '../lecture-ink-journal.js';
import {InkChangeTracker} from '../lecture-ink-patch.js';
import {bindLectureGestures} from '../lecture-gestures.js';
import {fittedHighlight,scribbleEraseTargets,INK_COLORS,inkBounds} from '../lecture-ink-geometry.js';
import {controlIcon,compactDisclosure,helpControl,syncControl} from '../quiet-controls.js';
import {startMicrophoneMeter} from '../prayer-meter.js';
import {quietMicrophone} from '../lecture-paper.js';
import { lectureSaveDelay, LECTURE_CLOUD_SAVE_MS } from '../lecture-save-cadence.js';
import {
  el,
  replace,
  append,
  button,
  heading,
  panel,
  empty,
  field,
  select,
  modal,
  busy,
  toast,
  download,
  formatDate,
  formatTime,
} from "../ui.js";
import { routeQuery } from "../targets.js";
import { LectureStorage } from "../lecture-storage.js";
import {
  LectureClock,
  LECTURE,
  recordingApproved,
  currentCourseEvent,
  samplePoint,
  hitStroke,
  strokeAudioTarget,
  validatePage,
} from "../lecture-core.js";
import { openLectureSources, openSourceCrop } from "../lecture-import.js";
import { LectureRecorder } from "../lecture-recorder.js";
const pad = (n) => String(n).padStart(4, "0");
const route = (course, id) =>
  "school?lectures=" +
  encodeURIComponent(course) +
  (id ? "&lecture=" + encodeURIComponent(id) : "");
const quiet = (label, fn) => button(label, fn, "quiet compact");
const blank = () => ({
  schemaVersion: 1,
  width: LECTURE.pageWidth,
  height: LECTURE.pageHeight,
  strokes: [],
});
const elapsed = (ms) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
export async function mountLectures(root, ctx) {
  const courses = ctx.records("course"),
    query = routeQuery(),
    courseId = query.get("lectures"),
    lectureId = query.get("lecture"),
    course = courses.find((c) => c.id === courseId),
    store = await new LectureStorage(
      "lifeos-lectures-" +
        (ctx.state.session?.environment ||
          ctx.state.bootstrap.environment ||
          "private"),
    ).open();
  if (!course) {
    const terms = new Map();
    for (const c of courses) {
      const term = c.data.term || "Current courses";
      if (!terms.has(term)) terms.set(term, []);
      terms.get(term).push(c);
    }
    replace(
      root,
      heading(
        "Lectures",
        null,
        el("div",{class:"actions"},quiet("Academics", () => ctx.go("school")),quiet("Check readiness",()=>showLectureReadiness(ctx))),
      ),
      ...Array.from(terms, ([term, list]) =>
        panel(
          term,
          list.map((c) =>
            el(
              "a",
              { class: "lecture-course", href: "#" + route(c.id) },
              el("strong", {}, c.data.code || c.data.title),
              el("span", {}, c.data.title || c.data.name),
            ),
          ),
        ),
      ),
      !courses.length ? empty("No course records are available yet.") : null,
    );
    return { destroy: () => store.close() };
  }
  if (!lectureId) return mountCourse(root, ctx, course, store);
  return query.has('audio')?persistentLecture(root,ctx,course,lectureId,store,(host,ctx,course,id,store)=>mountPhoneRecorder(host,{ctx,store,course,id}),true):persistentLecture(root, ctx, course, lectureId, store, mountWorkspace);
}
function permissionEditor(ctx, course, changed) {
  return async () => {
    try {
      const result = await ctx.request("/api/lecture-permission/" + course.id),
        current = result.item;
      const input = select(
        "Recording permission",
        [
          { value: "unknown", label: "Not confirmed" },
          { value: "approved-by-instructor", label: "Approved by instructor" },
          {
            value: "approved-by-accommodation",
            label: "Covered by accommodation",
          },
          { value: "approved-by-owner-confirmation", label: "Permission confirmed" },
          { value: "not-approved", label: "Not approved" },
        ],
        current?.data.state || "unknown",
      );
      modal(
        "Recording permission",
        el(
          "div",
          { class: "form-stack" },
          el("p", {}, "Have you received permission to record this course?"),
          input.node,
          button("Save", (event) =>
            busy(event.currentTarget, async () => {
              await ctx.request("/api/lecture-permission/" + course.id, {
                method: "PUT",
                body: {
                  state: input.input.value,
                  version: current?.version || 0,
                  mutationId: crypto.randomUUID(),
                },
              });
              document.querySelector("#dialog").close();
              changed?.(input.input.value);
            }),
          ),
        ),
      );
    } catch (e) {
      toast(e.message);
    }
  };
}
async function mountCourse(root, ctx, course, store) {
  let catalog={items:[],library:null};
  try { catalog=await ctx.request('/api/lecture-lessons?course='+encodeURIComponent(course.id));await store.put('lessons:'+course.id,catalog); }
  catch { catalog=await store.get('lessons:'+course.id)??catalog; }
  const due=el('div',{class:'lecture-review-due'});try{const reviews=await ctx.request('/api/lecture-reviews?course='+encodeURIComponent(course.id));const grouped=new Map();for(const item of reviews.items)grouped.set(item.lectureId,{title:item.lectureTitle,count:(grouped.get(item.lectureId)?.count??0)+1});for(const [lectureId,r]of grouped)due.append(el('a',{href:'#'+route(course.id,lectureId)+'&study=review'},`${r.title} · ${r.count} to review`));}catch{}
  const host = el("div"),
    create = button("+ Lecture", async () => {
      try {
        const now = new Date().toISOString(),
          event = currentCourseEvent(course, ctx.records("calendar-event")),
          permission = await ctx.request(
            "/api/lecture-permission/" + course.id,
          );
        const title = field("Title", {
            value:
              event?.title ||
              event?.summary ||
              (course.data.code || "Lecture") + " · " + formatDate(now),
            maxLength: 200,
          }),
          capture = select(
            "Start with",
            [
              { value: "notes", label: "Notes only" },
              { value: "audio", label: "Audio and notes" },
            ],
            "notes",
          );
        const lesson=select('Lesson',[
          {value:'',label:'Choose a lesson'},
          ...catalog.items.map(r=>({value:r.id,label:r.data.title})),
          {value:'custom',label:'Other lesson / notes without slides'}
        ],'');
        const chooseLesson=()=>{const chosen=catalog.items.find(r=>r.id===lesson.input.value);if(chosen)title.input.value=chosen.data.title;};
        chooseLesson();lesson.input.addEventListener('change',chooseLesson);
        let createBody = null;
        modal(
          "New lecture",
          el(
            "div",
            { class: "form-stack" },
            lesson.node,
            el('details',{},el('summary',{},'Lecture title'),title.node),
            recordingApproved(permission.item?.data.state)
              ? capture.node
              : el(
                  "p",
                  { class: "save-meta" },
                  "Notes are ready to use. Confirm course permission before starting audio.",
                ),
            button("Open lecture", (e) =>
              busy(e.currentTarget, async () => {
                if(!lesson.input.value)throw Error('Choose your lesson first.');
                if (
                  !createBody &&
                  (!title.input.value.trim() || title.input.value.length > 200)
                )
                  throw new Error(
                    "Use a lecture title between 1 and 200 characters.",
                  );
                createBody ||= {
                  courseId: course.id,
                  title: title.input.value,
                  startedAt: new Date().toISOString(),
                  mutationId: crypto.randomUUID(),
                  lessonId: lesson.input.value === 'custom' ? null : lesson.input.value,
                };
                title.input.disabled = true;
                lesson.input.disabled = true;
                const result = await ctx.request("/api/lectures", {
                  method: "POST",
                  body: createBody,
                });
                await store.put("lecture:" + result.item.id, {
                  item: result.item,
                  pages: [],
                  clips: [],
                });
                document.querySelector("#dialog").close();
                ctx.go(
                  route(course.id, result.item.id) +
                    (capture.input.value === "audio" ? "&record=1" : ""),
                );
              }),
            ),
          ),
        );
      } catch (e) {
        toast(e.message);
      }
    });
  replace(
    root,
    heading(
      course.data.code || course.data.title,
      null,
      quiet("All courses", () => ctx.go("school?lectures=all")),
    ),
    el("div", { class: "row" }, el("h2", {}, "Lectures"), create),
    due,host,
    catalog.library?.data.folderId ? el('a',{href:'https://drive.google.com/drive/folders/'+encodeURIComponent(catalog.library.data.folderId),target:'_blank',rel:'noopener'},'Course files in Drive') : null,
    catalog.library?.data.coverage==='partial' ? el('p',{class:'save-meta'},'Saved course files. New LEARN materials still need a source refresh.') : null,
    el(
      "details",
      {},
      el("summary", {}, "Course settings"),
      quiet("Recording permission", permissionEditor(ctx, course)),
    ),
  );
  let cursor = null,
    items = [];
  async function load() {
    try {
      const result = await ctx.request(
        "/api/lectures?course=" +
          encodeURIComponent(course.id) +
          (cursor ? "&after=" + encodeURIComponent(cursor) : ""),
      );
      items.push(...result.items);
      cursor = result.nextCursor;
      replace(
        host,
        ...items
          .sort((a, b) => b.data.startedAt.localeCompare(a.data.startedAt))
          .map((r) =>
            el(
              "div",
              { class: "lecture-course" },
              el("a", {href: "#" + route(course.id,r.id)},el("strong", {}, r.data.title)),
              trashEntryButton(ctx,{kind:"lecture",id:r.id,version:r.version,label:r.data.title},async()=>ctx.refresh({redraw:true})),
              el(
                "span",
                {},
                formatDate(r.data.startedAt) +
                  " · " +
                  formatTime(r.data.startedAt) +
                  " · " +
                  (r.data.recordingStatus === "available"
                    ? "Audio saved"
                    : ["partial", "pending"].includes(r.data.recordingStatus)
                      ? "Audio needs its recording device"
                      : r.data.importedRecordingCount
                        ? "Backup recording attached"
                        : "Notes") +
                  (r.data.endedAt ? " · " + elapsed(r.data.lastOffsetMs) : ""),
              ),
            ),
          ),
        !items.length ? empty("Your lectures will appear here.") : null,
        cursor ? quiet("More lectures", () => void load()) : null,
      );
    } catch (e) {
      replace(host, empty(e.message));
    }
  }
  await load();
  return { destroy: () => store.close() };
}
async function mountWorkspace(root, ctx, course, id, store) {
  let remote;
  try {
    remote = await ctx.request("/api/lectures/" + id);
    await store.put("lecture:" + id, remote);
  } catch (e) {
    remote = await store.get("lecture:" + id);
    if (!remote) throw e;
  }
  if (remote.item.data.courseId !== course.id)
    throw new Error("This lecture belongs to another course.");
  const editable=await editableLectureStore(store,id);store=editable.store;
  let dead=false,viewActive=true,releaseLock=editable.release,locked=true;
  let updating=false,updateReady=false;
  const resumeKey="update-resume:"+id,updateResume=validLectureResume(await store.get(resumeKey),id);
  let cloudRetryAt = 0,
    cloudFailures = 0,
    loadedPage = false,
    permission = remote.permission || "unknown",
    pageId = "0001",
    page = blank(),
    drawing = null,
    mode = "pen",
    width = 2.5,
    undo = [],
    redo = [],
    flushTimer = null,
    lastPageAttempt = 0,
    clockTimer,
    flushPromise,
    localError = null,
    cloudError = null,
    playingStroke = null,
    openingPage = false,
    pendingLocal = 0,
    color = INK_COLORS[0],
    dirty = false;
  const journals = new Map(), trackers = new Map(), disposables = [];
  const pages = new Map(),
    savedPages = new Map(remote.pages.map((p) => [p.data.pageId, p]));
  for (const key of await store.keys("page:" + id + ":", NOTEBOOK_MAX_PAGES+1)) {
    const local = await store.get(key);
    pages.set(key.split(":").at(-1), local);
  }
  for(const key of await store.keys('ink-state:'+id+':',NOTEBOOK_MAX_PAGES+1)){const p=key.split(':').at(-1),pending=(await store.keys('ink-pending:'+id+':'+p+':',1)).length>0;if(!pages.has(p))pages.set(p,{page:null,dirty:pending});else if(pending)pages.get(p).dirty=true;}
  const notebook=new LectureLayoutJournal({store,request:ctx.request,id});await notebook.open([...new Set([...savedPages.keys(),...pages.keys()])]);pageId=visibleNotebook(notebook.data)[0]??'0001';
  let spreadPositions=[],pageLoading=new Map(),openingDone=Promise.resolve(),resolveOpening;let penQueue=Promise.resolve(),penGroup=null;
  const rememberInk=operation=>{const entry={kind:'ink',pageId,operation};if(penGroup)penGroup.push(entry);else undo.push(entry);redo=[];};
  const rememberLayout=(layout,active=pageId)=>{undo.push({kind:'layout',layout:structuredClone(layout),pageId:active});redo=[];};
  const queuePen=fn=>{penQueue=penQueue.then(fn).catch(e=>{toast('Ink kept on this device: '+e.message);});};
  let high = Math.max(
    remote.item.data.lastOffsetMs || 0,
    ...remote.pages.map((p) => p.data.lastOffsetMs || 0),
    ...remote.clips.map((c) => c.data.endMs || c.data.startMs || 0),
    ...Array.from(pages.values(), (p) =>
      p.page?.strokes.reduce((n,s)=>Math.max(n,s.endedAtOffsetMs),0)??0,
    ),
  );
  for (const key of await store.keys("segment:" + id + ":")) {
    const s = await store.get(key);
    high = Math.max(high, s.endMs || s.startMs || 0);
  }
  let capture=null;try{if(!remote.item.data.endedAt)capture=await connectLectureClock({request:ctx.request,store,id,high});}catch(e){cloudError=e;}
  const clock = capture?.clock??new LectureClock({ base: high }),
    record = new LectureRecorder({
      id,
      store,
      clock,
      request: ctx.request,
      changed: updateStatus,
    });
  if (locked) await record.recoverInterrupted();
  let clipNext = Math.max(
    0,
    ...remote.clips.map((c) => Number(c.data.id) || 0),
  );
  const recordingMeta = (await store.get("recording:" + id)) || { next: 1 };
  recordingMeta.next = Math.max(recordingMeta.next, clipNext + 1);
  if (locked) await store.put("recording:" + id, recordingMeta);
  const anchor = {
    ...clock.anchor(),
    resumed: high > 0,
    discontinuity:
      high > 0 ? "Elapsed time while the page was closed is unknown." : null,
  };
  if (locked) await store.put("epoch:" + id + ":" + clock.epochId, anchor);
  const canvas = el("canvas", {
      class: "lecture-canvas",
      "aria-label": "Lecture notes. Draw with a pen or mouse. Enable finger writing in Paper options.",
    }),
    pageChrome=el("div",{class:"notebook-page-controls"}),
    paper = el("div",{class:"lecture-paper"},canvas,pageChrome),
    scroll = el("div", { class: "lecture-paper-scroll" }, paper),
    saveState = syncControl(()=>flush(true),{retryLabel:'Save notes now'}),
    saveStatus = saveState.node,
    timer = el("span", { class: "record-indicator" }, "Notes only"),
    audio = el("audio", {
      controls: true,
      preload: "metadata",
      class: "lecture-audio",
    }),
    pageLabel = el("span", {}),
    mic = el("meter", {
      min: 0,
      max: 1,
      value: 0,
      "aria-label": "Microphone activity",
      class: "lecture-meter",
    });
  disposables.push(saveState);
  let audioURL = null,
    currentClip = null,
    stopLiveMeter;
  const microphoneNotice=el('span',{class:'save-meta',role:'status'});
  audio.hidden = true;
  const run = (fn) => async (event) => {
    const control = event?.currentTarget;
    try {
      if(updating)throw Error("Saving your lecture for the update.");
      if (control) control.disabled = true;
      await fn();
    } catch (e) {
      toast(e.message);
    } finally {
      if (control?.isConnected) control.disabled = false;
    }
  };
  const recordButton = quiet(
    "Record",
    run(async () => {
      if (!locked)
        throw new Error(
          "This lecture is open in another tab, or this browser cannot safely lock recording.",
        );
      if (record.state === "recording") {
        await record.pause();
        stopMeter();
        return;
      }
      if (!recordingApproved(permission)) {
        modal(
          "Recording permission",
          el(
            "div",
            { class: "form-stack" },
            el("p", {}, "Have you received permission to record this course?"),
            quiet(
              "Permission confirmed",
              permissionEditor(ctx, course, (value) => {
                permission = value;
                updateStatus();
              }),
            ),
            quiet("Notes only", () =>
              document.querySelector("#dialog").close(),
            ),
          ),
        );
        return;
      }
      await beginRecording();
    }),
  );
  async function beginRecording(){
      await markActive();
      if(capture){const grant=await ctx.request('/api/lectures/'+id+'/capture',{method:'POST',body:{operation:'claim',deviceId:capture.deviceId,mutationId:crypto.randomUUID()}});capture.snapshot=grant;const meta=await store.get('recording:'+id)??{next:1};meta.next=Math.max(meta.next,grant.nextSegment);await store.put('recording:'+id,meta);}
      await record.start(permission);
      startMeter();
      updateStatus();
  }
  const savedFinishIntent=await store.get('finish-intent:'+id);
  let locallyFinished=savedFinishIntent?!!savedFinishIntent.at:!!remote.item.data.endedAt;
  function markActive(){if(!locallyFinished)return;locallyFinished=false;queueLectureSync({id,courseId:course.id,storeName:store.name});rememberLiveNote({id,courseId:course.id,storeName:store.name});finishButton.textContent='Finish';return finisher.reopen();}
  async function finishNow(){unbindGestures.flushPending();finishStroke();locallyFinished=true;finishButton.textContent='Unfinish';queueLectureSync({id,courseId:course.id,storeName:store.name});rememberLiveNote(null);void persist().catch(()=>{});const stopping=record.stop();record.release();stopMeter();void stopping.catch(e=>{localError=e;updateStatus();});void finisher.request();updateStatus();}
  const finishButton=quiet(locallyFinished?'Unfinish':'Finish',run(()=>confirmLectureFinish({finished:locallyFinished,finish:finishNow,reopen:markActive})));
  const finisher=getLectureFinisher(ctx,store,id,(state,error)=>{finishButton.textContent=locallyFinished?'Unfinish':'Finish';finishButton.disabled=false;recordButton.disabled=false;if(error){cloudError=error;updateStatus();}});
  let zoom=1.25,scribbleErase=true, scale=1, center=0, eraseBatch=[],eraseTrail=[],eraserRadius=2,eraserKind="object";
  const backgroundImages = new Map(),keyedImages=new BackgroundImageCache();let imageEditor=null,selectionEditor=null,imageImporting=0;const selectionImages=new Map();
  let slides=null,slidesOpening=false,sourceChoices=null,currentSlideContext=null,tutor=null,tutorHost=null,study=null,studyHost=null;
  async function toggleTutor(photoId){if(tutor){if(photoId){await tutor.attach(photoId);return;}await tutor.close();return;}if(studyHost)await toggleStudy();tutor=await openLectureTutor({ctx,store,id,getVisual:captureTutorView,getSlide:()=>currentSlideContext,getNote:currentStudyTarget,openSource:(source,page)=>showSlides(source,page),initialPhotoIds:photoId?[photoId]:[],onClose:()=>{tutor=null;tutorHost=null;}});tutorHost=tutor.element;}
  async function captureTutorView(){await penQueue;finishStroke();await persist();renderer.paint();const preview=document.createElement('canvas');let edge=1600,image;for(let n=0;n<5;n++){const ratio=Math.min(1,edge/Math.max(canvas.width,canvas.height));preview.width=Math.max(1,Math.round(canvas.width*ratio));preview.height=Math.max(1,Math.round(canvas.height*ratio));preview.getContext('2d').drawImage(canvas,0,0,preview.width,preview.height);image=preview.toDataURL('image/jpeg',.85-n*.08);if(image.length<=240000)break;edge=Math.round(edge*.8);}if(image.length>240000)throw Error('Zoom into the equation before asking the tutor.');return {note:{image,pageId,inkHead:savedPages.get(pageId)?.data.inkHead??0,capturedAt:new Date().toISOString(),region:[scroll.scrollLeft/scale,scroll.scrollTop/scale,scroll.clientWidth/scale,scroll.clientHeight/scale]},...(slides?.element?.isConnected&&!slides.element.hidden&&currentSlideContext?{slide:currentSlideContext}:{})};}
  async function insertPhoto(item,photo,{withinQueue=false}={}){if(!withinQueue)await penQueue;await pasteCrop(photoBackground(item,photo),{width:photo.width,height:photo.height});await store.put('photo-inserted:'+id+':'+item.id,{pageId});toast('Photo inserted.');}
  async function takePhoto(file){imageImporting++;try{const result=await saveLecturePhoto({ctx,store,id,file,insertRequested:true});if(result.state==='saved')await insertPhoto(result.item,result.photo);else toast('Photo kept on this device. Reconnect to upload.');}catch(e){toast(e.message);}finally{imageImporting--;}}
  let photoCheck=0,photoImporting=false;async function syncIncomingPhotos(){if(dead||!viewActive||updating||!locked||document.hidden||penGroup||drawing||openingPage||photoImporting||Date.now()-photoCheck<30000)return;photoCheck=Date.now();photoImporting=true;try{await flushLecturePhotos({ctx,store,id});const result=await ctx.request('/api/lectures/'+id+'/photos');for(const item of result.items.filter(r=>r.data.insertRequested)){if(await store.get('photo-inserted:'+id+':'+item.id))continue;const existing=[...savedPages.values()].find(p=>p.data.sourceBackground?.sourceId===item.id)||[...pages.values()].find(p=>p.page?.background?.sourceId===item.id||p.page?.attachments?.some(a=>a.background.sourceId===item.id));if(existing){await store.put('photo-inserted:'+id+':'+item.id,{found:true});continue;}if(drawing||openingPage)break;const photo=await readLecturePhoto({ctx,store,id,photoId:item.id});if(drawing||openingPage)break;const current=pageId,top=scroll.scrollTop,left=scroll.scrollLeft;const operation=penQueue.then(async()=>{await insertPhoto(item,photo,{withinQueue:true});scroll.scrollTop=top;scroll.scrollLeft=left;imageEditor?.update();selectionEditor?.update();});penQueue=operation.catch(e=>toast(e.message));await operation;break;}}catch{}finally{photoImporting=false;}}

  function currentStudyTarget(){return {pageId,offsetMs:clock.offset()};}
  async function openStudyTarget(target){if(innerWidth<1000&&studyHost)await toggleStudy();if(target.pageId){await openPage(target.pageId);const stroke=page.strokes.find(s=>s.id===(target.strokeId??target.id)),top=stroke?inkBounds(stroke).top:target.region?.[1]??0;scroll.scrollTop=((notebook.data.mode==='slides'?spreadPositions.find(p=>p.id===pageId)?.top??0:0)+Math.max(0,top-100))*scale;if(stroke){renderer.setPlaying(stroke.id);setTimeout(()=>!dead&&renderer.setPlaying(null),1800);}}else if(target.sourceId)await showSlides(target.sourceId,target.sourcePage);}
  async function captureStudyPage(){finishStroke();await persist();await flush(true);const current=savedPages.get(pageId);if(!current?.data.inkHead)throw Error('Save this note page before indexing.');const preview=document.createElement('canvas'),ratio=Math.min(1,900/canvas.width);preview.width=Math.round(canvas.width*ratio);preview.height=Math.round(canvas.height*ratio);preview.getContext('2d').drawImage(canvas,0,0,preview.width,preview.height);let image=preview.toDataURL('image/jpeg',.65);if(image.length>240000)image=preview.toDataURL('image/jpeg',.4);if(image.length>240000)throw Error('Zoom into a smaller note region before indexing.');return {pageId,inkHead:current.data.inkHead,image,region:[scroll.scrollLeft/scale,Math.max(0,scroll.scrollTop/scale-(notebook.data.mode==='slides'?spreadPositions.find(p=>p.id===pageId)?.top??0:0)),scroll.clientWidth/scale,scroll.clientHeight/scale]};}
  async function studyMarks(ids){const found=[];for(const key of ids){const loaded=await ensurePage(key),marks=mergeStudyMarks([],loaded.page.strokes),saved=savedPages.get(key);found.push(...marks);if(saved){const updated=await ctx.request('/api/lectures/'+id+'/study/marks',{method:'POST',body:{pageId:key,version:saved.version,marks,mutationId:crypto.randomUUID()}});savedPages.set(key,updated.item);const journal=journalFor(key);journal.state.version=updated.item.version;if(journal.state.manifest)journal.state.manifest.item=updated.item;await store.put(journal.key,journal.state);}}return found;}
  async function bookmark(){finishStroke();await persist();await flush(true);const current=currentStudyTarget(),result=await ctx.outbox.submit('/api/lectures/'+id+'/study',{id:id+'-s-'+crypto.randomUUID().replaceAll('-',''),version:0,data:{type:'bookmark',label:'Bookmark '+elapsed(current.offsetMs),...current}},'PUT');toast(result.item?'Bookmark saved':result.reason||'Bookmark saved on this device');if(study)await study.refresh();}
  async function playBookmark(offsetMs){const clips=await allClips(),clip=clips.find(c=>offsetMs>=c.startMs&&offsetMs<=c.endMs);if(!clip)throw Error('No saved audio covers this bookmark yet.');await playClip(clip,Math.max(0,(offsetMs-clip.startMs-LECTURE.leadInMs)/1000));}
  async function toggleStudy(){if(studyHost){study?.destroy();study=null;studyHost.remove();studyHost=null;if(slides?.element)slides.element.hidden=false;return;}if(tutorHost)await toggleTutor();studyHost=el('aside',{class:'lecture-study','aria-label':'Lecture study tools'});root.querySelector('.lecture-workspace').append(studyHost);if(slides?.element&&innerWidth<1000)slides.element.hidden=true;const host=studyHost;study=await mountStudyPane(host,{ctx,store,id,courseId:course.id,initialItemId:routeQuery().get('study'),onClose:()=>void toggleStudy(),getCurrent:currentStudyTarget,openTarget:openStudyTarget,playOffset:playBookmark,capturePage:captureStudyPage,openSource:(source,page)=>showSlides(source,page),getSlide:()=>currentSlideContext,scanMarks:studyMarks,checkSlides:(body,options)=>checkDeckUpdates({ctx,id,sourceId:currentSlideContext?.sourceId,body,...options,onSelect:async sourceId=>{sourceChoices=null;await showSlides(sourceId);}})});if(dead||host!==studyHost)study?.destroy();}
  function phoneLink(){const url=new URL(location.href);url.hash=route(course.id,id)+'&audio=1';const a=el('a',{href:url.href},'Open audio-only mode on this device'),copy=quiet('Copy phone link',async()=>{await navigator.clipboard.writeText(url.href);toast('Phone link copied');});modal('Record with your phone',el('div',{class:'form-stack'},el('p',{},'Open this lecture on your signed-in phone. Audio will follow the same timeline as these notes.'),a,copy));}
  async function addSourceBackground(background,dimensions) {
    if(dead||!locked)throw Error('Reopen this lecture to add notes.');
    const matches=p=>p?.background?.sourceId===background.sourceId&&p.background.sourceHash===background.sourceHash&&p.background.sourcePage===background.sourcePage&&JSON.stringify(p.background.crop)===JSON.stringify(background.crop);
    if(matches(page))return pageId;
    for(const key of new Set([...savedPages.keys(),...pages.keys()])){
      const local=pages.get(key), saved=savedPages.get(key);
      if(matches(local?.page)||(!local&&matches({background:saved?.data.sourceBackground}))){await openPage(key);return key;}
    }
    const previousLayout=structuredClone(notebook.data);const candidate={...blank(),height:dimensions?Math.max(400,Math.round(1000*dimensions.height/dimensions.width)):1400,background};validatePage(candidate);
    await openPage(pad(Math.max(0,...savedPages.keys(),...pages.keys())+1));
    page=candidate;pages.get(pageId).page=page;renderer.setPage(page,pageId);sizePaper();await persist();rememberLayout(undoInsertedPages(previousLayout,notebook.data));updateStatus();return pageId;
  }
  async function pasteCrop(background,dimensions){
    if(dead||!locked)throw Error('This lecture is read only.');
    finishStroke();
    const top=notebook.data.mode==='slides'?spreadPositions.find(p=>p.id===pageId)?.top??0:0;
    const attachment={id:crypto.randomUUID(),...imagePlacement(dimensions??{width:1000,height:700},Math.max(0,scroll.scrollTop/scale-top),scroll.clientHeight/scale),background};
    if((page.attachments?.length??0)>=128)throw Error('This page already has 128 images.');
    const height=Math.max(page.height,Math.ceil(attachment.y+attachment.height+150));
    validatePage({...blank(),height,attachments:[attachment]});
    page.height=height;(page.attachments??=[]).push(attachment);rememberInk({attachment:attachment.id,value:null});sizePaper();renderer.invalidate();await persist();imageEditor.select(pageId,attachment.id);
  }

  async function showSlides(selectedId,selectedPage){
    if(dead||slidesOpening)return;
    if(slides?.element?.isConnected&&!selectedId)return;
    slidesOpening=true;
    try{
      if(!sourceChoices){try{const response=await ctx.request(`/api/lectures/${id}/sources/list`);await store.put('deck-list:'+id,response.items);sourceChoices=response.items;}catch(e){sourceChoices=await store.get('deck-list:'+id);if(!sourceChoices)throw e;}sourceChoices=sourceChoices.filter(r=>['slides','notes'].includes(r.data.role)&&r.data.mimeType==='application/pdf').sort((a,b)=>String(b.data.modifiedTime??b.data.importedAt??'').localeCompare(String(a.data.modifiedTime??a.data.importedAt??'')));}
      const source=sourceChoices.find(r=>r.id===selectedId)||sourceChoices[0];
      if(!source)throw Error('No slides attached to this lesson yet. Use Notes & slides to attach a private PDF.');
      const bytes=await cachedLectureDeck({store,lectureId:id,source});if(dead)return;
      slides?.close();
      slides=await openSourceCrop({bytes,mimeType:source.data.mimeType,name:source.data.title,sourceId:source.id,floating:true,initialPage:selectedPage,pageRange:source.data.pageRange??remote.item.data.lessonPageRange,addBackground:addSourceBackground,addCrop:pasteCrop,openNotebook:async(context)=>{await notebook.update(l=>({...l,mode:"slides"}));sizePaper();renderPageControls();const selected=[...pages].find(([,p])=>p.page?.background?.sourceId===context?.sourceId&&p.page.background.sourcePage===context?.pageNumber);if(selected)await openPage(selected[0]);scheduleFlush();},onCurrent:context=>{currentSlideContext=context;}});
      if(dead){slides.close();return;}
      if(sourceChoices.length>1){const choice=select('Slide deck',sourceChoices.map((r,i)=>({value:r.id,label:r.data.title+(r.data.snapshot?' · version '+(i+1):'')})),source.id);choice.input.onchange=()=>void showSlides(choice.input.value).catch(e=>toast(e.message));slides.element.querySelector('.slide-dock-content').prepend(choice.node);}
    }finally{slidesOpening=false;}
  }
  async function attachDeck(){return openCourseDeckPicker({ctx,id,onAttach:async(item)=>{sourceChoices=null;await showSlides(item.id);},onOther:()=>openLectureSources({ctx,id,store,defaultRole:'slides',addBackground:addSourceBackground,addImage:pasteCrop,onSourceChange:()=>{sourceChoices=null;}})});}
  const iconButton=(name,label,fn)=>{const b=button(controlIcon(name),fn,'quiet icon-button');b.setAttribute('aria-label',label);b.title=label;return b;};
  const chooseMode=(value)=>{if(selectionEditor?.busy())return;unbindGestures.flushPending();finishStroke();imageEditor?.clear();selectionEditor?.clear();mode=value;updateStatus();};
  const penButton=iconButton('pen','Pen',()=>chooseMode('pen')),
    highlightButton=iconButton('highlighter','Highlighter',()=>chooseMode(highlightIntent.input.value)),
    eraserButton=iconButton('eraser','Eraser',()=>chooseMode('eraser')),
    lassoButton=iconButton('lasso','Lasso',()=>chooseMode('lasso')),
    listenButton=iconButton('headphones','Tap notes to listen',()=>chooseMode('listen')),
    undoButton=iconButton('undo','Undo',run(()=>historyStep(undo,redo))),
    redoButton=iconButton('redo','Redo',run(()=>historyStep(redo,undo)));
  lassoButton.dataset.mode='lasso';penButton.dataset.mode='pen';highlightButton.dataset.mode='highlight';eraserButton.dataset.mode='eraser';listenButton.dataset.mode='listen';
  const colors=el('div',{class:'ink-colors',role:'group','aria-label':'Pen color'},...INK_COLORS.map((c,i)=>{const b=button(el('span',{class:'ink-swatch',style:'--ink-color:'+c}),()=>{color=c;chooseMode('pen');for(const n of colors.children)n.setAttribute('aria-pressed',String(n===b));},'quiet icon-button');b.setAttribute('aria-label',['Dark blue','Blue','Red','Green','Violet','Brown'][i]);b.setAttribute('aria-pressed',String(i===0));return b;}));
  const penWidth=field('Stroke width',{type:'range',value:width,min:1,max:8,step:.5});penWidth.input.oninput=()=>{width=Number(penWidth.input.value);};
  const eraseSize=field('Eraser radius',{type:'range',min:1,max:30,step:.5,value:eraserRadius}),eraseLabel=el('output',{},'2');eraseSize.input.oninput=()=>{eraserRadius=Number(eraseSize.input.value);eraseLabel.textContent=String(eraserRadius);};
  const eraseType=select('Erase',[{value:'object',label:'Whole stroke'},{value:'pixel',label:'Part of stroke'}],'object');eraseType.input.onchange=()=>{finishStroke();eraserKind=eraseType.input.value;eraserRadius=eraserKind==='object'?2:6;eraseSize.input.value=eraserRadius;eraseLabel.textContent=String(eraserRadius);};
  const eraseOptions=compactDisclosure({label:'Eraser size and mode',icon:'chevron-down',content:el('div',{class:'ink-properties'},eraseType.node,eraseSize.node,eraseLabel)});
  const graphDimensions=select('Dimensions',[{value:'1',label:'Number line'},{value:'2',label:'2D graph'},{value:'3',label:'3D graph'}],'2'),graphNegatives=el('input',{type:'checkbox',checked:false,'aria-label':'Include negatives'});
  const graphButton=iconButton('graph','Draw graph',()=>chooseMode('graph'));graphButton.dataset.mode='graph';
  const graphOptions=compactDisclosure({label:'Graph options',icon:'chevron-down',content:el('div',{class:'ink-properties'},graphDimensions.node,el('label',{},graphNegatives,'Include negatives'))});
  const penOptions=compactDisclosure({label:'Pen color and width',icon:'chevron-down',content:el('div',{class:'ink-properties'},colors,penWidth.node)});
  const highlightIntent=select('Highlight meaning',[{value:'unclear',label:'Needs explaining'},{value:'unfinished',label:'Unfinished'}],'unclear');highlightIntent.input.onchange=()=>chooseMode(highlightIntent.input.value);
  const highlightOptions=compactDisclosure({label:'Highlight options',icon:'chevron-down',content:highlightIntent.node});
  const lines=el('input',{type:'checkbox',checked:true,'aria-label':'Lined paper'});lines.onchange=()=>{if(!locked)return;rememberInk({lined:page.lined!==false});page.lined=lines.checked;renderer.invalidate();void persist().catch(()=>{});};
  const scribble=el('input',{type:'checkbox',checked:scribbleErase,'aria-label':'Scribble to erase'});scribble.onchange=()=>{scribbleErase=scribble.checked;};
  const touchInk=el('input',{type:'checkbox',checked:false,'aria-label':'Draw with touch'});
  const paperOptions=compactDisclosure({label:'Paper options',icon:'more',content:el('div',{class:'ink-properties'},quiet('Test microphone',()=>{if(record.state==='recording')throw Error('Pause lecture recording before the microphone check');microphoneCheck();}),quiet('Record with phone',phoneLink),el('label',{},touchInk,'Draw with touch'),el('label',{},lines,'Lined paper'),el('label',{},scribble,'Scribble to erase'),quiet('New page',run(()=>insertBlankPage(pageId))),quiet('Import notes or slides',run(()=>openLectureSources({ctx,id,store,addBackground:addSourceBackground,addImage:pasteCrop,onSourceChange:()=>{sourceChoices=null;}}))),quiet('Export notes',run(exportNotes)),quiet('Audio files',run(showDetails)),quiet('Pull Updates',run(pullUpdates)))});
  const zoomLabel=quiet('Fit',()=>setZoom(1)),zoomOptions=compactDisclosure({label:'Paper zoom',icon:'zoom',content:el('div',{class:'ink-zoom-actions'},quiet('−',()=>setZoom(zoom/1.25)),zoomLabel,quiet('+',()=>setZoom(zoom*1.25)))});
  const help=helpControl('Pencil and mouse write. Enable Draw with touch in Paper options for finger writing; otherwise one finger pans and two pinch to zoom. Scribble back and forth to erase, or use Undo. Highlight a line or circle writing to mark it.','Note tools');
  disposables.push(penOptions,highlightOptions,eraseOptions,graphOptions,paperOptions,zoomOptions,help);
  const deleteImageButton=iconButton('trash','Delete selected image',()=>void (selectionEditor?.hasSelection()?selectionEditor.deleteSelected():imageEditor?.deleteSelected()));deleteImageButton.disabled=true;
  const tools=el('div',{class:'lecture-tools',role:'toolbar','aria-label':'Note tools'},el('div',{class:'ink-tool-group'},penButton,penOptions.node,eraserButton,eraseOptions.node,lassoButton,highlightButton,highlightOptions.node),el('div',{class:'ink-tool-group'},graphButton,graphOptions.node),el('div',{class:'ink-tool-group'},undoButton,redoButton,deleteImageButton),el('div',{class:'ink-tool-group'},listenButton,zoomOptions.node),help.node);
  const prevPage=iconButton('left','Previous page',run(()=>adjacentPage(-1))),nextPage=iconButton('right','Next page',run(()=>adjacentPage(1)));pageLabel.setAttribute('role','button');pageLabel.tabIndex=0;pageLabel.onclick=managePages;pageLabel.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();managePages();}};
  recordButton.classList.add('lecture-record');finishButton.classList.add('lecture-finish');
  replace(root,el('section',{class:'lecture-workspace'},
    el('header',{class:'lecture-top'},quiet('‹ '+(course.data.code||'Course'),()=>ctx.go(route(course.id))),el('strong',{},remote.item.data.title),saveStatus,timer,mic,recordButton,finishButton,paperOptions.node),
    microphoneNotice,tools,scroll,
    el('div',{class:'lecture-bottom'},el('div',{class:'lecture-pages'},prevPage,pageLabel,nextPage),iconButton('bookmark','Bookmark this moment',run(bookmark)),iconButton('study','Study tools',run(toggleStudy)),iconButton('chat','Lecture Tutor',run(toggleTutor)),iconButton('camera','Take lecture photo',()=>chooseLecturePhoto(takePhoto,{camera:true})),iconButton('paste','Paste image',run(()=>pasteLecturePhoto(takePhoto))),iconButton('image','Lecture photos',run(()=>showLecturePhotos({ctx,store,id,onInsert:insertPhoto,onTutor:toggleTutor}))),quiet('Transcript',run(showTranscript)),quiet('Slides',run(()=>showSlides())),iconButton('add','Add slide deck',run(attachDeck)),audio)));
  document.body.classList.add("lecture-open");
  const lectureViewport=()=>{if(slides?.element)slides.element.hidden=!!studyHost&&innerWidth<1000;const v=window.visualViewport;root.style.setProperty("--lecture-viewport-height",(v?.height??innerHeight)+"px");root.style.setProperty("--lecture-viewport-top",(v?.offsetTop??0)+"px");};lectureViewport();window.visualViewport?.addEventListener("resize",lectureViewport);window.visualViewport?.addEventListener("scroll",lectureViewport);
  const chromeSizer=new ResizeObserver(()=>{const top=root.querySelector('.lecture-top').offsetHeight,bottom=root.querySelector('.lecture-bottom').offsetHeight;root.style.setProperty('--lecture-header-height',top+'px');root.style.setProperty('--lecture-footer-height',bottom+'px');});chromeSizer.observe(root.querySelector('.lecture-top'));chromeSizer.observe(root.querySelector('.lecture-bottom'));
  const historyKey=e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!e.target.closest?.('input,textarea,[contenteditable=true]')){e.preventDefault();void historyStep(e.shiftKey?redo:undo,e.shiftKey?undo:redo).catch(x=>toast(x.message));}};root.addEventListener('keydown',historyKey);
  const rejectSelection=e=>{if(!e.target.closest?.("input,textarea,[contenteditable=true]"))e.preventDefault();};root.addEventListener("selectstart",rejectSelection);root.addEventListener("contextmenu",rejectSelection);
  function updateStatus() {
    if (dead || !saveStatus) return;
    timer.textContent =
      record?.state === "recording"
        ? elapsed(clock.offset()) + " recording"
        : record?.state === "paused"
          ? "Paused"
          : remote.item.data.recordingStatus === "available"
            ? elapsed(remote.item.data.lastOffsetMs) + " lecture"
            : remote.item.data.importedRecordingCount
              ? "Backup recording attached"
              : "Notes only";
    if(capture?.snapshot.recorderDevice&&capture.snapshot.recorderDevice!==capture.deviceId){timer.textContent=Date.now()-(capture.snapshot.seenAt??0)>90000?'Phone connection paused':capture.snapshot.recorderState==='recording'?'Phone recording':'Phone paused';}
    timer.classList.toggle("recording", record?.state === "recording"||capture?.snapshot.recorderState==='recording');
    recordButton.textContent =
      record?.state === "recording" ? "Pause" : "Record";
    const pendingCloud=notebook.pending||Array.from(pages.values()).some(p=>p.dirty);
    const issue=localError||record?.error||cloudError||record?.uploadError;
    saveState.update({mode:issue?'alert':dirty||pendingCloud||record?.state==='recording'?'device':'cloud',detail:localError?'This device could not save the newest ink. Export before closing.':record?.error?'Recording stopped: '+record.error.message:cloudError||record?.uploadError?'Saved on this device. Cloud sync needs retry.':dirty?'Saving on this device…':pendingCloud?'Saved on this device. Cloud upload pending.':record?.state==='recording'?'Recording on this device. Finished segments upload automatically.':'Notes saved to LifeOS',retry:!!issue||pendingCloud});
    for(const b of tools.querySelectorAll('[data-mode]'))b.setAttribute('aria-pressed',String(b.dataset.mode==='highlight'?['unclear','unfinished'].includes(mode):b.dataset.mode===mode));
    undoButton.disabled=!locked||!undo.length;redoButton.disabled=!locked||!redo.length;
    const ordered=visibleNotebook(notebook.data);pageLabel.textContent=ordered.includes(pageId)?'Page '+(ordered.indexOf(pageId)+1):'Pages';prevPage.disabled=openingPage||ordered.indexOf(pageId)<=0;nextPage.disabled=openingPage||ordered.indexOf(pageId)>=ordered.length-1;
    lines.checked=page.lined!==false;zoomLabel.textContent=Math.round(zoom*100)+'% · Fit';
    if(!locked)saveState.update({mode:'alert',detail:'Read only. Close the other lecture tab to edit.',retry:false});
  }
  const renderer=new NotebookRenderer({canvas,paintPaper,getPage:key=>pages.get(key)?.inkLoaded?pages.get(key).page:null,needPage:ensurePage});
  const shapeHold=new ShapeHold({changed:()=>draw()});
  function imageFor(background){let image=backgroundImages.get(background.dataUrl);if(!image){image=new Image();if(backgroundImages.size>12)backgroundImages.clear();backgroundImages.set(background.dataUrl,image);image.onload=()=>renderer.invalidate();image.src=background.dataUrl;}return image;}
  function paintPaper(context,view,currentPage=page){
    const top=Math.max(0,view.top/view.scale),bottom=Math.min(currentPage.height,(view.top+view.height)/view.scale);
    context.fillStyle='#f8f7f1';context.fillRect(0,top,1000,bottom-top);
    if(!currentPage.background&&currentPage.lined!==false){context.strokeStyle='#d9e0e5';context.lineWidth=.6;context.beginPath();for(let y=Math.max(60,60+Math.floor((top-60)/PAPER_LINE_SPACING)*PAPER_LINE_SPACING);y<bottom;y+=PAPER_LINE_SPACING){context.moveTo(30,y);context.lineTo(970,y);}context.stroke();}
    if(currentPage.background){const image=imageFor(currentPage.background);if(image.complete&&image.naturalWidth){const fit=1000/image.naturalWidth;context.drawImage(image,(1000-image.naturalWidth*fit)/2,0,image.naturalWidth*fit,image.naturalHeight*fit);}}
    for(const original of currentPage.attachments??[]){const a=selectionImages.get(original.id)??original;if(a.y+a.height<top||a.y>bottom)continue;const image=imageFor(a.background);if(image.complete&&image.naturalWidth)drawNoteImage(context,keyedImages.get(image,a.keying),a);}
  }
  function draw(){if(dead)return;renderer.setPlaying(playingStroke);renderer.render(drawing);}
  function viewport(){paper.style.setProperty('--note-control-left',Math.max(0,scroll.scrollLeft+scroll.clientWidth-104)+'px');renderer.setViewport({width:Math.max(1,scroll.clientWidth),height:Math.max(1,notebook.data.mode==='slides'?scroll.clientHeight:Math.min(scroll.clientHeight,page.height*scale)),scale,left:scroll.scrollLeft,top:scroll.scrollTop,center});imageEditor?.update();selectionEditor?.update();}
  function sizePaper(){scale=Math.max(1,scroll.clientWidth)*zoom/LECTURE.pageWidth;center=Math.max(0,(scroll.clientWidth-LECTURE.pageWidth*scale)/2);spreadPositions=notebookOffsets(visibleNotebook(notebook.data),key=>pages.get(key)?.page??{height:savedPages.get(key)?.data.height??1400});renderer.setNotebook(notebook.data.mode==='slides'?spreadPositions:null);paper.style.width=Math.max(scroll.clientWidth,LECTURE.pageWidth*scale)+'px';paper.style.height=(notebook.data.mode==='slides'?(spreadPositions.at(-1)?.top??0)+(spreadPositions.at(-1)?.height??1400):page.height)*scale+'px';renderPageControls();viewport();}
  function setZoom(value,event){finishStroke();const rect=canvas.getBoundingClientRect(),x=event?event.clientX-rect.left:scroll.clientWidth/2,y=event?event.clientY-rect.top:scroll.clientHeight/2,worldX=(x+scroll.scrollLeft-center)/scale,worldY=(y+scroll.scrollTop)/scale;zoom=Math.max(.35,Math.min(4,value));sizePaper();scroll.scrollLeft=Math.max(0,worldX*scale-x+center);scroll.scrollTop=Math.max(0,worldY*scale-y);viewport();updateStatus();}
  function audioActive(){return record.state==='recording'||!!(capture?.snapshot.recorderDevice&&capture.snapshot.recorderDevice!==capture.deviceId&&capture.snapshot.recorderState==='recording');}
  function paperPoint(e){const rect=canvas.getBoundingClientRect(),point=samplePoint(e,rect,clock);if(drawing?.timingBasis==='callback-time'&&drawing.startedAtOffsetMs===0&&!drawing.audioSegmentId||!drawing&&!audioActive())point.offsetMs=0;return {...point,x:(e.clientX-rect.left+scroll.scrollLeft-center)/scale,y:(e.clientY-rect.top+scroll.scrollTop)/scale-(notebook.data.mode==='slides'?spreadPositions.find(p=>p.id===pageId)?.top??0:0)};}
  const resize=new ResizeObserver(sizePaper);resize.observe(scroll);scroll.addEventListener('scroll',viewport,{passive:true});
  function journalFor(key){let journal=journals.get(key);if(!journal){journal=new LectureInkJournal({store,request:ctx.request,lectureId:id,pageId:key,changed:updateStatus});journals.set(key,journal);}return journal;}
  async function openPage(next){
    if(openingPage)return;if(selectionEditor?.busy())throw Error('Finish the selection before changing pages.');selectionEditor?.clear();imageEditor?.clear();if(Number(next)>NOTEBOOK_MAX_PAGES)throw Error('This notebook has reached its page limit. Export or create another notebook.');
    finishStroke();if(loadedPage)await persist();openingPage=true;openingDone=new Promise(r=>resolveOpening=r);updateStatus();
    try{
      const journal=journalFor(next),local=await ensurePage(next);
      pageId=next;page=local.page;page.height=Math.max(400,page.height);pages.set(next,local);trackers.set(next,new InkChangeTracker(page));const newBlank=locked&&local.version===0&&!local.dirty&&!page.epochs?.length;if(newBlank)page.epochs=[anchor];
      const last=page.strokes.reduce((n,s)=>Math.max(n,s.endedAtOffsetMs),0);if(last>clock.offset()){clock.base+=last-clock.offset();anchor.offsetMs=clock.offset();anchor.wallAt=new Date().toISOString();if(locked)await store.put('epoch:'+id+':'+clock.epochId,anchor);}
      loadedPage=true;if(!notebook.data.pageIds.includes(next))await notebook.update(l=>editNotebook(l,{type:'insert',id:next}));pageLabel.textContent='Page '+(visibleNotebook(notebook.data).indexOf(pageId)+1);renderer.setPage(page,pageId);sizePaper();scroll.scrollTop=notebook.data.mode==='slides'?(spreadPositions.find(p=>p.id===pageId)?.top??0)*scale:0;scroll.scrollLeft=0;cloudError=journal.cloudError??null;
      if(newBlank)await persist();if(local.dirty)scheduleFlush();const order=visibleNotebook(notebook.data),i=order.indexOf(pageId);for(const near of [order[i-1],order[i+1]].filter(Boolean))void ensurePage(near).catch(()=>{});
    }finally{openingPage=false;resolveOpening?.();updateStatus();}
  }

  async function ensurePage(key){if(pages.get(key)?.inkLoaded)return pages.get(key);if(pageLoading.has(key))return pageLoading.get(key);const operation=(async()=>{const local=pages.get(key),loaded=await journalFor(key).open({legacy:local?.page?local:null}),result={page:loaded.page,version:loaded.version,dirty:!!loaded.pending,inkLoaded:true};pages.set(key,result);if(!trackers.has(key))trackers.set(key,new InkChangeTracker(result.page));return result;})();pageLoading.set(key,operation);try{return await operation;}finally{pageLoading.delete(key);}}
  function activateAt(event){if(notebook.data.mode!=='slides')return true;const rect=canvas.getBoundingClientRect(),y=(event.clientY-rect.top+scroll.scrollTop)/scale,target=spreadPositions.find(e=>y>=e.top&&y<e.top+e.height);if(!target)return false;if(target.id===pageId)return true;const loaded=pages.get(target.id);if(!loaded?.inkLoaded){void ensurePage(target.id).then(()=>{renderer.invalidate();toast('Page ready to write.');}).catch(e=>toast(e.message));return false;}finishStroke();void persist().catch(()=>{});pageId=target.id;page=loaded.page;if(!trackers.has(pageId))trackers.set(pageId,new InkChangeTracker(page));renderer.setPage(page,pageId);pageLabel.textContent='Page '+(visibleNotebook(notebook.data).indexOf(pageId)+1);updateStatus();return true;}
  async function adjacentPage(delta){const ids=visibleNotebook(notebook.data),at=ids.indexOf(pageId),next=ids[at+delta];if(next)await openPage(next);}
  async function insertBlankPage(after){if(!locked)throw Error('This lecture is read only in this tab.');const prior=structuredClone(notebook.data);finishStroke();await persist();const next=pad(Math.max(0,...savedPages.keys(),...pages.keys(),...notebook.data.pageIds)+1);const reference=pages.get(after)?.page??{height:savedPages.get(after)?.data.height??1400};await openPage(next);page={...blank(),height:reference.height??1400,growthStep:Math.max(200,Math.round((reference.height??1400)/2)),lined:true,epochs:[anchor]};pages.get(pageId).page=page;renderer.setPage(page,pageId);await persist();rememberLayout(undoInsertedPages(prior,notebook.data),after);await notebook.update(l=>editNotebook(l,{type:'move',id:next,before:l.pageIds[l.pageIds.indexOf(after)+1]===next?l.pageIds[l.pageIds.indexOf(after)+2]:l.pageIds[l.pageIds.indexOf(after)+1]}));sizePaper();scroll.scrollTop=(spreadPositions.find(p=>p.id===next)?.top??0)*scale;updateStatus();scheduleFlush();}
  async function removeNotebookPage(key){if(!locked)return;await penQueue;finishStroke();await persist();rememberLayout(notebook.data);await notebook.update(l=>editNotebook(l,{type:'hide',id:key}));const next=visibleNotebook(notebook.data)[0];if(next&&key===pageId)await openPage(next);sizePaper();scheduleFlush();updateStatus();toast('Page removed. Undo restores it.');}

  function renderPageControls(){if(!locked||notebook.data.mode!=='slides'){pageChrome.replaceChildren();return;}replace(pageChrome,...spreadPositions.map((entry,index)=>{const add=iconButton('add','Insert blank page after page '+(index+1),run(()=>insertBlankPage(entry.id))),remove=iconButton('trash','Remove page '+(index+1),run(()=>removeNotebookPage(entry.id))),controls=el('div',{class:'notebook-page-actions',style:'top:'+((entry.top+entry.height)*scale-46)+'px;left:var(--note-control-left,calc(100% - 104px))'},add,remove);return controls;}));}
  function managePages(){const list=el('div',{class:'notebook-page-list'});const render=()=>{replace(list,...visibleNotebook(notebook.data).map((key,index)=>{const data=pages.get(key)?.page,background=data?.background??savedPages.get(key)?.data.sourceBackground,handle=iconButton('drag','Move page '+(index+1),()=>{}),row=el('div',{class:'notebook-page-row'},background?el('img',{src:background.dataUrl,alt:''}):el('span',{class:'blank-page-preview'},''),button('Page '+(index+1),run(async()=>{document.querySelector('#dialog').close();await openPage(key);}),'text-button'),handle,iconButton('trash','Remove page '+(index+1),run(async()=>{await removeNotebookPage(key);render();})));const move=async at=>{if(!locked)return;rememberLayout(notebook.data);await notebook.update(l=>{const others=visibleNotebook(l).filter(id=>id!==key);return editNotebook(l,{type:'move',id:key,before:others[Math.max(0,at)]});});sizePaper();render();scheduleFlush();};dragSchedule(handle,row,list,at=>void move(at).catch(e=>toast(e.message)),list);handle.onkeydown=e=>{if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();void move(index+(e.key==='ArrowUp'?-1:1));}};return row;}));};render();const undoLayout=button('Undo page change',run(async()=>{if(!locked)return;await historyStep(undo,redo);render();}),'text-button'),restore=el('details',{},el('summary',{},'Removed pages'),...notebook.data.hidden.map(key=>button('Restore page '+key,run(async()=>{if(!locked)return;rememberLayout(notebook.data);await notebook.update(l=>editNotebook(l,{type:'restore',id:key}));sizePaper();render();scheduleFlush();}),'text-button')));modal('Pages',el('div',{},list,undoLayout,restore,button(notebook.data.mode==='slides'?'Single page view':'Continuous pages',run(async()=>{if(!locked)return;rememberLayout(notebook.data);await notebook.update(l=>({...l,mode:l.mode==='slides'?'page':'slides'}));document.querySelector('#dialog').close();sizePaper();scheduleFlush();}),'text-button')));}
  let persistence=Promise.resolve();const unsavedLocal=new Set();
  async function persist(){
    if(!locked||!loadedPage||imageEditor?.dragging())return;const key=pageId,tracker=trackers.get(key),journal=journalFor(key);
    let patch=tracker.changes(page);if(!patch){await persistence;return;}
    if(!page.epochs?.some(e=>e.epochId===anchor.epochId)){page.epochs=[...(page.epochs??[]),anchor];patch=tracker.changes(page);}
    const immutable=structuredClone(patch);tracker.acknowledge(page,patch);pages.get(key).page=page;pages.get(key).dirty=true;pendingLocal++;dirty=true;unsavedLocal.add(key);
    const write=journal.enqueue(immutable);persistence=Promise.all([persistence.catch(()=>{}),write]).then(()=>{});persistence.catch(()=>{});
    try{await write;unsavedLocal.delete(key);localError=null;}catch(error){localError=error;throw error;}finally{pendingLocal--;dirty=pendingLocal>0;updateStatus();scheduleFlush();}
  }
  function scheduleFlush() {
    if (dead || flushTimer !== null || ['ink-conflict','conflict','ink-client-update','layout-conflict'].includes(cloudError?.code)) return;
    const delay = Math.max(LECTURE_CLOUD_SAVE_MS, lectureSaveDelay(lastPageAttempt, Date.now(), cloudRetryAt));
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush().catch(() => {});
    }, delay);
  }
  async function flush(force = false) {
    if (!locked) return;
    if (!force && lectureSaveDelay(lastPageAttempt, Date.now(), cloudRetryAt) > 0) { scheduleFlush(); return; }
    if (flushPromise) return flushPromise;
    clearTimeout(flushTimer); flushTimer = null;
    flushPromise = (async () => {
      if(force){for(const [key,journal]of journals)if(journal.localError||journal.pendingMemory.size){await journal.retryLocal();unsavedLocal.delete(key);}if(!unsavedLocal.size)localError=null;}
      await persistence.catch(error=>{if(!force)throw error;});
      for(const [key,local]of pages){const journal=journalFor(key);if(!local?.dirty)continue;lastPageAttempt=Date.now();const result=await journal.flush({maxBatches:force?16:4});local.dirty=result.pending;local.version=journal.state.version;if(journal.state.manifest?.item)savedPages.set(key,journal.state.manifest.item);}
      if(!Array.from(pages.values()).some(p=>p.dirty)&&notebook.data.pageIds.every(key=>savedPages.has(key)))await notebook.flush();
      await record.flush({ force });
      cloudError = null;
      cloudFailures = 0;
      cloudRetryAt = 0;
    })()
      .catch((e) => {
        cloudError = e;
        cloudFailures++;
        cloudRetryAt =
          Date.now() +
          Math.min(300000, 30000 * 2 ** Math.min(cloudFailures - 1, 4));
        throw e;
      })
      .finally(() => {
        flushPromise = null;
        updateStatus();
        if (
          !dead &&
          (notebook.pending || Array.from(pages.values()).some((p) => p.dirty))
        ) {
          scheduleFlush();
        }
      });
    return flushPromise;
  }
  function changedInk(stroke){trackers.get(pageId)?.mark(stroke);renderer.invalidate();}
  async function historyStep(from,to){if(!locked||openingPage||selectionEditor?.busy())return;selectionEditor?.clear();imageEditor?.clear();await penQueue;finishStroke();const operation=from.pop();if(!operation)return;
    async function apply(entry){
      if(entry.kind==='group'){const reverse=[];for(const child of entry.entries.toReversed())reverse.push(await apply(child));return {kind:'group',entries:reverse};}
      if(entry.kind==='layout'){const inverse={kind:'layout',layout:structuredClone(notebook.data),pageId};await notebook.set(entry.layout);const next=visibleNotebook(notebook.data).includes(entry.pageId)?entry.pageId:visibleNotebook(notebook.data)[0];if(next&&next!==pageId)await openPage(next);sizePaper();scheduleFlush();return inverse;}
      if(entry.pageId!==pageId)await openPage(entry.pageId);const op=entry.operation;let inverse;
      if(op.attachment){const items=page.attachments??[],at=items.findIndex(a=>a.id===op.attachment);inverse={attachment:op.attachment,value:at<0?null:items[at],index:at};if(at>=0)items.splice(at,1);if(op.value)items.splice(Math.max(0,op.index??items.length),0,op.value);page.attachments=items;}
      else if(op.lined!==undefined){inverse={lined:page.lined!==false};page.lined=op.lined;lines.checked=page.lined;}
      else{const edits=Array.isArray(op)?op:[op],reverse=[];for(const o of edits){const stroke=renderer.strokes.get(o.id);if(stroke){reverse.push({id:stroke.id,hidden:!!stroke.hidden});stroke.hidden=o.hidden;changedInk(stroke);}}inverse=reverse;}
      sizePaper();renderer.invalidate();await persist();return {kind:'ink',pageId:entry.pageId,operation:inverse};
    }
    try{to.push(await apply(operation));draw();updateStatus();}catch(e){from.push(operation);throw e;}
  }
  function finishStroke(event){
    shapeHold.stop();
    if(eraseTrail.length){const edits=[];for(const original of renderer.visible().filter(s=>strokeNear(s,eraseTrail,eraserRadius))){const fragments=eraseFragments(original,eraseTrail,eraserRadius);edits.push({id:original.id,hidden:false});original.hidden=true;changedInk(original);for(const points of fragments){const fragment={...original,id:crypto.randomUUID(),sourceStrokeId:original.sourceStrokeId??original.id,points,shape:undefined,graph:undefined,hidden:false,startedAtOffsetMs:points[0].offsetMs,endedAtOffsetMs:points.at(-1).offsetMs};page.strokes.push(fragment);renderer.add(fragment);edits.push({id:fragment.id,hidden:true});}}eraseTrail=[];renderer.preview.clear();if(edits.length){rememberInk(edits);void persist().catch(()=>{});}renderer.invalidate();}

    if(eraseBatch.length){rememberInk(eraseBatch);eraseBatch=[];void persist().catch(()=>{});updateStatus();}
    if(!drawing)return;
    const stroke=drawing;drawing=null;stroke.endedAtOffsetMs=stroke.timingBasis==='callback-time'&&stroke.startedAtOffsetMs===0&&!stroke.audioSegmentId?0:Math.max(stroke.points.at(-1).offsetMs,event?clock.eventOffset(event.timeStamp):clock.offset());
    const bottom=inkBounds(stroke).bottom;if(notebook.data.mode!=='slides'&&!page.background&&bottom>page.height-450){page.height=Math.min(1000000,Math.max(page.height+1000,bottom+600));sizePaper();}
    if(stroke.graph&&Math.hypot(stroke.graph.to.x-stroke.graph.from.x,stroke.graph.to.y-stroke.graph.from.y)<18){draw();return;}
    const erased=scribbleErase&&!stroke.shape&&!stroke.graph&&stroke.intent==='ink'?scribbleEraseTargets(stroke,renderer.visible()):[];
    if(erased.length){const change=[];for(const id of erased){const s=renderer.strokes.get(id);change.push({id,hidden:!!s.hidden});s.hidden=true;changedInk(s);}stroke.hidden=true;rememberInk(change);}
    else{if(['unclear','unfinished'].includes(stroke.intent)){const fitted=fittedHighlight(stroke,renderer.visible());if(fitted&&fitted.regions.length<=64){stroke.highlightRegions=fitted.regions;stroke.highlightedStrokeIds=fitted.strokeIds;}}rememberInk({id:stroke.id,hidden:true});}
    page.strokes.push(stroke);renderer.add(stroke);redo=[];void persist().catch(()=>{});updateStatus();
  }
  function startStroke(e,strokeMode=mode){markActive();const mode=strokeMode;if(openingPage)return;finishStroke(e);if(!activateAt(e))return;const p=paperPoint(e);if(p.x<0||p.x>1000||p.y<0||p.y>page.height)return;
    drawing={id:crypto.randomUUID(),pageId,epochId:clock.epochId,createdAt:new Date().toISOString(),width:['unclear','unfinished'].includes(mode)?20:width,color:mode==='unclear'?'#e2b62f':mode==='unfinished'?'#67b4ca':color,intent:['unclear','unfinished'].includes(mode)?mode:'ink',points:[p],startedAtOffsetMs:p.offsetMs,endedAtOffsetMs:p.offsetMs,audioSegmentId:record.state==='recording'?record.segmentForOffset(p.offsetMs):null,timingBasis:!audioActive()?'callback-time':clock.shared?'shared-clock':clock.lastEventBasis};if(mode==='graph')drawing.graph={from:{x:p.x,y:p.y},to:{x:p.x,y:p.y},dimensions:Number(graphDimensions.input.value),negatives:graphNegatives.checked,spacing:PAPER_LINE_SPACING};draw();
  }
  async function moveStroke(e){if(!drawing||openingPage)return;const p=paperPoint(e);if(p.x<0||p.x>1000){finishStroke(e);return;}
    if(notebook.data.mode==='slides'&&!page.background){page.growthStep??=Math.max(200,Math.round(page.height/2));const height=growBlankPage(page.height,p.y,page.growthStep);if(height!==page.height){page.height=height;sizePaper();}}
    if(notebook.data.mode==='slides'&&(p.y<0||p.y>page.height)){
      const top=spreadPositions.find(v=>v.id===pageId)?.top??0,last=drawing.points.at(-1),parts=splitAcrossPages({...last,y:last.y+top},{...p,y:p.y+top},spreadPositions),sourceStrokeId=drawing.sourceStrokeId??drawing.id;
      for(const segment of parts){if(segment.pageId!==pageId){finishStroke(e);await persist();const local=await ensurePage(segment.pageId);pageId=segment.pageId;page=local.page;renderer.setPage(page,pageId);drawing={id:crypto.randomUUID(),pageId,epochId:clock.epochId,createdAt:new Date().toISOString(),width:['unclear','unfinished'].includes(mode)?20:width,color:mode==='unclear'?'#e2b62f':mode==='unfinished'?'#67b4ca':color,intent:['unclear','unfinished'].includes(mode)?mode:'ink',sourceStrokeId,points:[segment.from],startedAtOffsetMs:segment.from.offsetMs,endedAtOffsetMs:segment.from.offsetMs,audioSegmentId:record.state==='recording'?record.segmentForOffset(segment.from.offsetMs):null,timingBasis:!audioActive()?'callback-time':clock.shared?'shared-clock':clock.lastEventBasis};}
        drawing.points.push(segment.to);
      }
    }else{if(p.y<0||p.y>page.height){finishStroke(e);return;}p.offsetMs=Math.max(drawing.points.at(-1).offsetMs,p.offsetMs);if(drawing.points.length>=2400){finishStroke(e);startStroke(e);}else drawing.points.push(p);}
    if(drawing?.graph){const p=drawing.points.at(-1);drawing.graph.to={x:p.x,y:p.y};}else if(drawing?.intent==='ink')shapeHold.move(drawing);draw();
  }
  function eraseAt(e){if(openingPage||!activateAt(e))return;const p=paperPoint(e);if(eraserKind==='pixel'){const last=eraseTrail.at(-1);if(last&&Math.hypot(last.x-p.x,last.y-p.y)<eraserRadius/2)return;if(last){const count=Math.min(100,Math.ceil(Math.hypot(last.x-p.x,last.y-p.y)/Math.max(1,eraserRadius)));for(let n=1;n<count;n++)eraseTrail.push({...p,x:last.x+(p.x-last.x)*n/count,y:last.y+(p.y-last.y)*n/count});}eraseTrail.push(p);for(const stroke of renderer.visible().filter(s=>strokeNear(s,[p],eraserRadius))){renderer.preview.set(stroke.id,eraseFragments(stroke,eraseTrail,eraserRadius).map(points=>({...stroke,points,shape:undefined,graph:undefined})));}renderer.invalidate();return;}const hit=renderer.visible().toReversed().find(s=>strokeNear(s,[p],eraserRadius));if(hit&&!hit.hidden){eraseBatch.push({id:hit.id,hidden:false});hit.hidden=true;changedInk(hit);draw();}}
  const copyPen=e=>Object.fromEntries(['clientX','clientY','pressure','tiltX','tiltY','timeStamp','buttons','pointerId','pointerType'].map(k=>[k,e[k]]));
  imageEditor=lectureImageEditor({paper,scroll,
    selectionChanged:()=>updateDeleteSelection(),
    onDuplicate:async(key,image)=>{if(key!==pageId||!locked||updating)return;const original=page.attachments.find(a=>a.id===image.id);if(!original)throw Error('This image is no longer on the page.');if(page.attachments.length>=128)throw Error('This page already has 128 images.');const copy={...original,id:crypto.randomUUID(),x:Math.min(1000-original.width,original.x+24),y:Math.min(1000000-original.height,original.y+24)};rememberInk({attachment:copy.id,value:null});page.attachments.push(copy);page.height=Math.max(page.height,Math.min(1000000,Math.ceil(copy.y+copy.height+150)));sizePaper();renderer.invalidate();await persist();updateStatus();return copy;},
    onDelete:async(key,image)=>{if(key!==pageId||!locked||updating)return;const at=page.attachments.findIndex(a=>a.id===image.id);if(at<0)return;rememberInk({attachment:image.id,value:page.attachments[at],index:at});page.attachments=page.attachments.filter(a=>a.id!==image.id);renderer.invalidate();await persist();updateStatus();},
    getOriginal:async attachment=>{const image=imageFor(attachment.background);await image.decode();return image;},
    canEdit:()=>locked&&mode!=='lasso'&&!updating&&!openingPage&&!drawing&&!penGroup,
    getImages:()=>{const layout=notebook.data.mode==='slides'?spreadPositions:[{id:pageId,top:0}];return layout.flatMap(row=>(pages.get(row.id)?.page?.attachments??[]).map(image=>({pageId:row.id,top:row.top,image})));},
    view:()=>{const rect=canvas.getBoundingClientRect();return {scale,center,left:rect.left,top:rect.top};},
    activate:key=>{if(key===pageId)return true;const loaded=pages.get(key);if(!loaded?.inkLoaded)return false;finishStroke();void persist().catch(()=>{});pageId=key;page=loaded.page;if(!trackers.has(key))trackers.set(key,new InkChangeTracker(page));renderer.setPage(page,key);updateStatus();return true;},
    preview:(key,image)=>{const target=pages.get(key)?.page;if(!target)return;target.attachments=target.attachments.map(a=>a.id===image.id?image:a);const height=Math.max(target.height,Math.ceil(image.y+image.height+150));if(height!==target.height){target.height=height;sizePaper();}renderer.invalidate();},
    commit:async(key,before,after)=>{if(before!==after)rememberInk({attachment:before.id,value:before,index:page.attachments.findIndex(a=>a.id===before.id)});await persist();updateStatus();}
  });
  const pasteImage=event=>{if(event.defaultPrevented||event.target.closest?.('input,textarea,[contenteditable=true]'))return;const file=pastedLectureImage(event);if(file){event.preventDefault();void takePhoto(file);}};root.addEventListener('paste',pasteImage);
  selectionEditor=lectureSelectionEditor({paper,scroll,view:()=>{const r=canvas.getBoundingClientRect();return{scale,center,left:r.left,top:r.top};},getMode:()=>mode,canEdit:()=>locked&&!updating&&!openingPage&&!drawing&&!penGroup,changed:updateDeleteSelection,
    selectItems:async path=>{imageEditor.clear();await penQueue;finishStroke();const min=Math.min(...path.map(p=>p.y)),max=Math.max(...path.map(p=>p.y));const rows=(notebook.data.mode==='slides'?spreadPositions:[{id:pageId,top:0,height:page.height}]).filter(r=>r.top<=max&&r.top+r.height>=min);for(const r of rows)await ensurePage(r.id);return lassoSelection(rows.map(r=>({...r,page:pages.get(r.id).page})),path);},preview:previewSelection,commit:commitSelection,copy:copySelection});
  let objectInput=null;
  const selectionInput={start:e=>{objectInput=null;if(selectionEditor.input.start(e)){objectInput=selectionEditor.input;return true;}if(imageEditor.input.start(e)){objectInput=imageEditor.input;return true;}return false;},beforePen:e=>{objectInput=null;if(mode==='lasso'){imageEditor.clear();if(selectionEditor.input.beforePen(e))objectInput=selectionEditor.input;return true;}selectionEditor.clear();if(imageEditor.input.beforePen(e)){objectInput=imageEditor.input;return true;}return false;},move:e=>objectInput?.move(e),end:e=>{const input=objectInput;objectInput=null;void input?.end(e);},cancel:()=>{objectInput?.cancel();objectInput=null;},tap:e=>imageEditor.input.tap(e)};
  const unbindGestures=bindLectureGestures({canvas,scroll,imageInput:selectionInput,onDoubleTap:()=>chooseMode(mode==='pen'?'eraser':'pen'),getMode:()=>mode,getTouchInk:()=>touchInk.checked,getZoom:()=>zoom,setZoom,canWrite:()=>locked&&!updating,start:e=>{const sample=copyPen(e),strokeMode=mode;queuePen(async()=>{if(openingPage)await openingDone;penGroup=[];if(notebook.data.mode==='slides'){const target=spreadPositions.find(p=>{const y=(sample.clientY-canvas.getBoundingClientRect().top+scroll.scrollTop)/scale;return y>=p.top&&y<p.top+p.height;});if(target)await ensurePage(target.id);}startStroke(sample,strokeMode);});},move:e=>{for(const sample of e.getCoalescedEvents?.()?.length?e.getCoalescedEvents():[e]){const copied=copyPen(sample);queuePen(()=>moveStroke(copied));}},end:e=>{const sample=copyPen(e);queuePen(()=>{finishStroke(sample);if(penGroup?.length)undo.push({kind:'group',entries:penGroup});penGroup=null;updateStatus();});},erase:eraseAt,listen:e=>{if(openingPage||!activateAt(e))return;const p=paperPoint(e),hit=hitStroke(renderer.visible(),p.x,p.y);if(hit)void playStroke(hit).catch(e=>toast(e.message));}});
  const flushTapControl=e=>{if(e.pointerType!=='pen'||e.target.closest?.('button,input,select,textarea,a,[role=button]'))unbindGestures.flushPending();};root.addEventListener('pointerdown',flushTapControl,true);
  function updateDeleteSelection(){deleteImageButton.title=selectionEditor?.hasSelection()?'Delete selected notes':'Delete selected image';deleteImageButton.setAttribute('aria-label',deleteImageButton.title);deleteImageButton.disabled=!(selectionEditor?.hasSelection()||imageEditor?.current())||!locked||updating;}
  function previewSelection(items,before,after){selectionImages.clear();for(const child of renderer.children.values())child.preview.clear();if(items.length){const scale=after.width/before.width;for(const item of items){if(item.type==='attachment'){const moved=transformSelection([item],before,after)[0];selectionImages.set(item.value.id,moved.value);}else{const child=renderer.child(item.pageId,pages.get(item.pageId).page);child.preview.set(item.value.id,[{...item.value,displayOriginal:item.value,displayTransform:{scale,x:after.x-before.x*scale,y:after.y-before.y*scale+item.top*(scale-1)}}]);}}}renderer.invalidate();}
  async function commitSelection(kind,items,before,target){if(kind==='move'&&['x','y','width','height'].every(k=>Math.abs(before[k]-target[k])<.001))return items;const oldPage=pageId,top=scroll.scrollTop,left=scroll.scrollLeft,entries=[],result=[];const moved=transformSelection(items,before,kind==='duplicate'?constrainSelection(items,before,{...before,x:before.x+24,y:before.y+24}):target);previewSelection([],null,null);
    const group={kind:'group',entries};undo.push(group);redo=[];try{
    for(const key of new Set(items.map(i=>i.pageId))){await ensurePage(key);pageId=key;page=pages.get(key).page;renderer.setPage(page,key);if(!trackers.has(key))trackers.set(key,new InkChangeTracker(page));
      for(let n=0;n<items.length;n++){const item=items[n];if(item.pageId!==key)continue;let next=moved[n].value;
        if(item.type==='stroke'){const original=page.strokes.find(s=>s.id===item.value.id);if(!original||original.hidden)throw Error('Selected notes changed. Select them again.');const changes=[];if(kind!=='duplicate'){changes.push({id:original.id,hidden:false});original.hidden=true;trackers.get(key).mark(original);}if(kind!=='delete'){next={...next,id:crypto.randomUUID(),sourceStrokeId:original.sourceStrokeId??original.id,hidden:false};page.strokes.push(next);changes.push({id:next.id,hidden:true});result.push({...moved[n],value:next});}entries.push({kind:'ink',pageId:key,operation:changes});}
        else{const at=page.attachments.findIndex(a=>a.id===item.value.id);if(at<0)throw Error('Selected image changed. Select it again.');if(kind==='duplicate'){next={...next,id:crypto.randomUUID()};page.attachments.push(next);entries.push({kind:'ink',pageId:key,operation:{attachment:next.id,value:null}});}else{entries.push({kind:'ink',pageId:key,operation:{attachment:item.value.id,value:page.attachments[at],index:at}});if(kind==='delete')page.attachments.splice(at,1);else page.attachments[at]=next;}if(kind!=='delete')result.push({...moved[n],value:next});}
      }renderer.child(key,page).setPage(page);await persist();
    }return result;}finally{if(!entries.length)undo=undo.filter(v=>v!==group);pageId=oldPage;page=pages.get(oldPage).page;renderer.setPage(page,oldPage);scroll.scrollTop=top;scroll.scrollLeft=left;renderer.invalidate();updateStatus();}
  }
  async function copySelection(items,bounds){if(!items.length)return;items=structuredClone(items);bounds={x:bounds.x-20,y:bounds.y-20,width:bounds.width+40,height:bounds.height+40};const build=async()=>{const scale=Math.min(2,8192/bounds.height,Math.sqrt(4000000/(bounds.width*bounds.height))),copy=document.createElement('canvas');copy.width=Math.max(1,Math.ceil(bounds.width*scale));copy.height=Math.max(1,Math.ceil(bounds.height*scale));const ctx=copy.getContext('2d');ctx.scale(scale,scale);ctx.translate(-bounds.x,-bounds.y);for(const item of items.filter(i=>i.type==='attachment')){const image=imageFor(item.value.background);await image.decode();ctx.save();ctx.translate(0,item.top);drawNoteImage(ctx,keyedImages.get(image,item.value.keying),item.value);ctx.restore();}for(const item of items.filter(i=>i.type==='stroke')){ctx.save();ctx.translate(0,item.top);renderer.child(item.pageId,pages.get(item.pageId).page).paintStroke(ctx,item.value);ctx.restore();}return new Promise((resolve,reject)=>copy.toBlob(b=>b?resolve(b):reject(Error('Selection could not be copied.')),'image/png'));};
    const blob=build();try{if(!navigator.clipboard?.write||!globalThis.ClipboardItem)throw Error();await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);toast('Selection copied.');}catch{download('lifeos-selected-notes.png',await blob,'image/png');toast('Clipboard unavailable. Selection downloaded instead.');}
  }
  async function allClips() {
    if(clock.shared)try{const latest=await ctx.request('/api/lectures/'+id);remote.clips=latest.clips;}catch{}
    const list = new Map(remote.clips.map((c) => [c.data.id, c.data]));
    for (const key of await store.keys("segment:" + id + ":")) {
      const s = await store.get(key);
      list.set(s.id, { ...list.get(s.id), ...s });
    }
    return [...list.values()].sort((a, b) => a.startMs - b.startMs);
  }
  async function playClip(clip, seconds = 0, stroke = null) {
    let blob;
    if (clip.status === "captured") blob = await record.segmentBlob(clip);
    else {
      try {
        const response = await fetch("/api/files/" + clip.recordingId, {
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok)
          throw new Error("Audio could not load. Sign in or retry.");
        const reader = response.body.getReader(),
          parts = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > LECTURE.maxSegmentBytes) {
            await reader.cancel();
            throw new Error("Audio exceeds the segment limit");
          }
          parts.push(value);
        }
        blob = new Blob(parts, { type: clip.mimeType });
      } catch (e) {
        if (await store.get("chunk:" + id + ":" + clip.id + ":0000"))
          blob = await record.segmentBlob(clip);
        else throw e;
      }
    }
    if (audioURL) URL.revokeObjectURL(audioURL);
    audioURL = URL.createObjectURL(blob);
    audio.hidden = false;
    const ready = new Promise((resolve, reject) => {
      audio.onloadedmetadata = resolve;
      audio.onerror = () =>
        reject(new Error("This recording format could not play."));
    });
    audio.src = audioURL;
    await ready;
    currentClip = clip;
    const durationMs = audio.duration * 1000;
    if (stroke) {
      const mapped = strokeAudioTarget(stroke, [
        {
          ...clip,
          status: "saved",
          mediaDurationMs: Number.isFinite(durationMs) ? durationMs : null,
        },
      ]);
      seconds = mapped.seconds;
      playingStroke = stroke.id;
    }
    audio.currentTime = seconds;
    await audio.play();
    draw();
  }
  async function playStroke(stroke) {
    const clips = await allClips(),
      playable = clips.map((c) => ({
        ...c,
        status: c.status === "captured" ? "saved" : c.status,
      })),
      target = strokeAudioTarget(stroke, playable);
    if (!target) {
      toast(
        stroke.audioSegmentId
          ? "Pause recording to listen to this note. Interrupted audio is available in Audio & details."
          : "Audio was not recording for this note.",
      );
      return;
    }
    await playClip(
      clips.find((c) => c.id === target.clipId),
      target.seconds,
      stroke,
    );
  }
  audio.addEventListener("ended", () => {
    void allClips()
      .then((clips) => {
        const next = clips
          .filter((c) => ["saved", "captured"].includes(c.status))
          .find((c) => c.startMs > currentClip.startMs);
        return next ? playClip(next) : null;
      })
      .catch((e) => toast(e.message));
  });
  let transcriptDock=null,transcriptRows=[];
  function highlightTranscript(at){let active=null;for(const row of transcriptRows){const selected=at>=row.segment.startMs&&at<row.segment.endMs;row.node.classList.toggle('transcript-active',selected);row.node.setAttribute('aria-current',selected?'true':'false');if(selected)active=row.node;}if(active)active.scrollIntoView({block:'nearest',behavior:'instant'});}
  async function showTranscript(){
   if(transcriptDock?.isConnected){transcriptDock.remove();transcriptDock=null;return;}
   const transcript=remote.transcript;if(!transcript?.segments?.length){toast('No transcript is available for this recording. Standalone transcription uses a labelled sample.');return;}
   transcriptDock=el('section',{class:'lecture-transcript','aria-label':'Lecture transcript'});transcriptRows=transcript.segments.map(segment=>{const node=button(el('span',{},elapsed(segment.startMs)+' · '+segment.text),run(async()=>{const clips=await allClips(),clip=clips.find(c=>c.startMs<=segment.startMs&&c.endMs>segment.startMs);if(clip)await playClip(clip,(segment.startMs-clip.startMs)/1000);highlightTranscript(segment.startMs);}),'text-button');transcriptDock.append(node);return {segment,node};});root.querySelector('.lecture-workspace').append(transcriptDock);highlightTranscript(currentClip?currentClip.startMs+audio.currentTime*1000:0);
  }
  audio.addEventListener("timeupdate", () => {
    if (!currentClip) return;
    const duration =
      Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : (currentClip.endMs - currentClip.startMs) / 1000;
    const at =
        currentClip.startMs +
        (audio.currentTime / duration) *
          (currentClip.endMs - currentClip.startMs),
      stroke = page.strokes.find(
        (s) =>
          !s.hidden &&
          s.audioSegmentId === currentClip.id &&
          s.startedAtOffsetMs <= at &&
          s.endedAtOffsetMs + 1500 >= at,
      );
    highlightTranscript(at);
    const selected = stroke?.id || null;
    if (selected !== playingStroke) {
      playingStroke = selected;
      draw();
    }
  });
  async function exportNotes() {
    let importedSources = (await store.get("sources:" + id)) || [],
      sourceManifestState = "cached-only";
    try {
      importedSources = (await ctx.request(`/api/lectures/${id}/sources/list`))
        .items;
      await store.put("sources:" + id, importedSources);
      sourceManifestState = "current";
    } catch {}
    const exportPages = [];
    for (const key of new Set([...savedPages.keys(), ...pages.keys()])) {
      const local = pages.get(key);
      const content =
        key === pageId
          ? page
          : local?.page ||
            (await journalFor(key).open({legacy:local?.page?local:null})).page;
      exportPages.push({ pageId: key, ...content });
    }
    const epochs = [];
    for (const key of await store.keys("epoch:" + id + ":"))
      epochs.push(await store.get(key));
    download(
      "lifeos-lecture-" + id + ".json",
      JSON.stringify(
        {
          schemaVersion: 1,
          lecture: remote.item,
          course: {
            id: course.id,
            code: course.data.code,
            term: course.data.term,
          },
          clockEpochs: epochs,
          audioSegments: await allClips(),
          importedSources,
          sourceManifestState,
          pages: exportPages,
          notebookLayout: notebook.data,
          review: {
            status: "not-processed",
            originalTextPreserved: true,
            imageHighlights: exportPages.flatMap((p) =>
              (p.background?.reviewRegions || []).map((rect) => ({
                pageId: p.pageId,
                intent: "unclear",
                rect,
                sourceId: p.background.sourceId,
                sourcePage: p.background.sourcePage,
                provenance: "user-confirmed-yellow-highlight",
              })),
            ),
            requests: exportPages.flatMap((p) =>
              p.strokes
                .filter(
                  (s) =>
                    !s.hidden && ["unclear", "unfinished"].includes(s.intent),
                )
                .map((s) => ({
                  pageId: p.pageId,
                  strokeId: s.id,
                  intent: s.intent,
                  source: p.background
                    ? {
                        sourceId: p.background.sourceId,
                        sourcePage: p.background.sourcePage,
                        crop: p.background.crop,
                      }
                    : null,
                })),
            ),
          },
        },
        null,
        2,
      ),
      "application/json",
    );
  }
  async function showDetails() {
    const clips = await allClips();
    modal(
      "Lecture files",
      el(
        "div",
        {},
        record.emergencyChunks?.length
          ? el(
              "div",
              {},
              el(
                "p",
                { class: "notice" },
                "Local storage failed. These newest audio chunks are only in memory. Download them before closing this tab.",
              ),
              ...record.emergencyChunks.map((c) =>
                quiet("Export emergency audio " + c.index, () =>
                  download(
                    "lecture-emergency-" + c.segmentId + "-" + c.index,
                    c.blob,
                    c.blob.type,
                  ),
                ),
              ),
              quiet("I saved these audio files", () => {
                record.emergencyAcknowledged = true;
                document.querySelector("#dialog").close();
              }),
            )
          : null,
        el(
          "p",
          { class: "save-meta" },
          "Audio and unsent notes stay on this device. Keep LifeOS open while recording. Screen lock or another app can interrupt iPad audio.",
        ),
        ...clips.map((s) =>
          el(
            "div",
            { class: "practice-row" },
            el(
              "strong",
              {},
              `Audio ${s.id} · ${elapsed(s.startMs)}${s.endMs != null ? " to " + elapsed(s.endMs) : ""}`,
            ),
            el(
              "p",
              {},
              s.status === "saved"
                ? "Saved privately online"
                : s.status === "capturing"
                  ? "Recording on this device"
                  : s.status === "recovery-needed"
                    ? "Interrupted. Local chunks available for recovery."
                    : "Saved on this device. Upload pending.",
            ),
            s.status === "saved"
              ? el(
                  "a",
                  {
                    href: "/api/files/" + s.recordingId,
                    download: "lecture-audio-" + s.id,
                  },
                  "Download audio",
                )
              : null,
            quiet(
              "Export local audio",
              run(async () => {
                if (!s.chunks)
                  throw new Error(
                    "There is no local audio copy on this device. Use Download audio.",
                  );
                if (s.status === "capturing")
                  throw new Error(
                    "Pause recording before exporting this segment.",
                  );
                if (s.bytes <= LECTURE.maxSegmentBytes) {
                  download(
                    "lecture-audio-" +
                      s.id +
                      (s.mimeType.includes("mp4") ? ".mp4" : ".webm"),
                    await record.segmentBlob(s),
                    s.mimeType,
                  );
                } else {
                  for (let i = 0; i < s.chunks; i++)
                    download(
                      `lecture-audio-${s.id}-chunk-${pad(i)}`,
                      await store.get(`chunk:${id}:${s.id}:${pad(i)}`),
                      s.mimeType,
                    );
                }
              }),
            ),
          ),
        ),
        quiet("Export notes", run(exportNotes)),
        quiet(
          "Notes & slides",
          run(() =>
            openLectureSources({
              ctx,
              id,
              store,
              addBackground: addSourceBackground,addImage:pasteCrop,
              onSourceChange:()=>{sourceChoices=null;},
            }),
          ),
        ),
        quiet("Review cloud copy of this page", run(reviewCloudPage)),
        quiet("Export preserved device copies", run(exportRecoveries)),
        quiet(
          "Recording permission",
          permissionEditor(ctx, course, (value) => {
            permission = value;
            updateStatus();
          }),
        ),
      ),
    );
  }
  async function pullUpdates(){
    if(!locked)throw Error('Close the other tab editing this lecture before updating.');
    if(selectionEditor?.busy())throw Error("Finish the selection before updating.");
    if(imageImporting||photoImporting)throw Error('Wait for the image to finish saving, then pull updates.');
    if(tutor?.beforeLeave&&!await tutor.beforeLeave())return;
    updating=true;paperOptions.hide();toast('Saving notes before updating...');
    try{await pullLectureUpdate({
      wasRecording:record.state==='recording',
      checkRelease:async()=>{const response=await fetch('/_lifeos-release.json',{cache:'no-store',credentials:'same-origin'});if(!response.ok)throw Error('Connect to LifeOS before pulling updates.');return response.json();},
      pause:async()=>{await record.pause();stopMeter();},resume:beginRecording,
      checkpoint:async()=>{await penQueue;finishStroke();imageEditor?.clear();await persist();await notebook.queue;await record.pending;if(record.error||record.emergencyChunks?.length)throw Error('Audio still needs recovery. Keep this lecture open.');await flush(true);if(notebook.pending||[...pages.values()].some(p=>p.dirty)||unsavedLocal.size||localError)throw Error('Notes are not fully synced yet. Retry Pull Updates when the connection returns.');await record.flush({force:true});return {lectureId:id,pageId,top:scroll.scrollTop,left:scroll.scrollLeft,zoom,mode,width,color,undo,redo,tutor:!!tutor,study:!!study,slide:slides?.element?.isConnected?currentSlideContext:null};},
      saveResume:state=>store.put(resumeKey,state),
      reload:async()=>{updateReady=true;window.removeEventListener('beforeunload',unload);location.reload();}
    });}catch(error){updating=false;updateReady=false;throw error;}
  }
  async function reviewCloudPage() {
    if (!locked) throw new Error("This lecture is read only in this tab.");
    if (flushPromise) await flushPromise.catch(() => {});
    await persistence.catch(() => {});
    const latest = await ctx.request("/api/lectures/" + id),
      row = latest.pages.find((p) => p.data.pageId === pageId);
    if (!row) throw new Error("This page has no cloud copy yet.");
    modal(
      "Use saved cloud page?",
      el(
        "div",
        {},
        el(
          "p",
          {},
          "Your current device copy will be preserved separately. This changes only the page shown on this device.",
        ),
        button(
          "Use cloud page",
          run(async () => {
            const key = pageId;
            await store.put(
              "recovery-page:" + id + ":" + key + ":" + crypto.randomUUID(),
              {
                pageId: key,
                page: structuredClone(page),
                preservedAt: new Date().toISOString(),
              },
            );
            const old=journalFor(key);await old.preservePending();
            journals.delete(key);pages.delete(key);savedPages.set(key,row);
            cloudError=null;document.querySelector('#dialog').close();
            loadedPage=false;await openPage(key);
            updateStatus();
          }),
        ),
      ),
    );
  }
  async function exportRecoveries() {
    const copies = [];
    for (const key of await store.keys("recovery-page:" + id + ":"))
      copies.push(await store.get(key));
    if (!copies.length)
      throw new Error("There are no preserved device copies.");
    download(
      "lifeos-lecture-device-copies-" + id + ".json",
      JSON.stringify({ schemaVersion: 1, lectureId: id, copies }, null, 2),
      "application/json",
    );
  }
  function startMeter() {
    stopLiveMeter?.();
    let lastSound=performance.now(),lastCheck=lastSound;
    stopLiveMeter=startMicrophoneMeter(record.stream,level=>{
      mic.value=level;
      const now=performance.now();
      if(now-lastCheck>2000||level>0.02)lastSound=now;
      lastCheck=now;
      const warning=quietMicrophone(level,now-lastSound)?'Microphone is very quiet. Check its position and input.':'';
      if(microphoneNotice.textContent!==warning)microphoneNotice.textContent=warning;
    },available=>{mic.hidden=!available;if(!available&&record.state==='recording')microphoneNotice.textContent='Microphone level unavailable. Check a short recording.';});
  }
  function stopMeter() {
    stopLiveMeter?.();stopLiveMeter=null;
    microphoneNotice.textContent='';
    mic.value = 0;
  }
  async function syncPause(){if(!capture||!await store.get('pause-intent:'+id))return;await ctx.request('/api/lectures/'+id+'/capture',{method:'POST',body:{operation:'pause',deviceId:capture.deviceId,mutationId:crypto.randomUUID()}});await store.remove('pause-intent:'+id);}
  async function pauseLecture(){unbindGestures.flushPending();finishStroke();const pausing=record.pause();record.release();stopMeter();await pausing;await persist();if(capture){await store.put('pause-intent:'+id,true);void syncPause().catch(()=>{});}updateStatus();}
  const offline=()=>{if(viewActive)void pauseLecture().catch(e=>{localError=e;updateStatus();});};window.addEventListener('offline',offline);
  const visibility = () => {
    if (!viewActive)return;if (document.hidden) {void pauseLecture().catch(()=>{});} else {void flush().catch(()=>{});sizePaper();}
  };
  document.addEventListener("visibilitychange", visibility);
  const online = () => {void syncPause().catch(()=>{});void flush(true).catch(() => {});void finisher.retry();},
    unload = (e) => {
      if(updateReady)return;
      if (
        record.state === "recording" ||
        (record.emergencyChunks?.length && !record.emergencyAcknowledged) ||
        !!drawing || dirty || unsavedLocal.size > 0 || !!localError || !!imageImporting
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
  window.addEventListener("online", online);
  window.addEventListener("beforeunload", unload);
  const photoTimer=setInterval(()=>void syncIncomingPhotos(),15000);void syncIncomingPhotos();
  let lastCaptureBeat=0;const captureTimer=capture?setInterval(async()=>{if(dead||(!viewActive||document.hidden)&&record.state!=='recording')return;try{if(capture.snapshot.recorderDevice===capture.deviceId&&Date.now()-lastCaptureBeat>60000){capture.snapshot=await ctx.request('/api/lectures/'+id+'/capture',{method:'POST',body:{operation:'heartbeat',deviceId:capture.deviceId,state:record.state==='recording'?'recording':'paused',mutationId:crypto.randomUUID()}});lastCaptureBeat=Date.now();}else capture.snapshot=await ctx.request('/api/lectures/'+id+'/capture');if(capture.snapshot.finishRequestedAt&&record.state==='recording')void finishNow();else if(capture.snapshot.pauseRequestedAt&&record.state==='recording')void pauseLecture();updateStatus();}catch(e){if(record.state==='recording')void pauseLecture().catch(()=>{});}},15000):null;
  clockTimer = setInterval(() => {
    if (!document.hidden && record.state === "recording") updateStatus();
  }, 1000);
  try {
    if(updateResume){zoom=updateResume.zoom??zoom;mode=updateResume.mode??mode;width=updateResume.width??width;color=updateResume.color??color;pageId=visibleNotebook(notebook.data).includes(updateResume.pageId)?updateResume.pageId:pageId;}
    await openPage(pageId);if(updateResume){scroll.scrollTop=updateResume.top??0;scroll.scrollLeft=updateResume.left??0;undo=updateResume.undo??[];redo=updateResume.redo??[];viewport();}if(routeQuery().has('study')||updateResume?.study)await toggleStudy();
  } catch (e) {
    dead = true;
    clearInterval(clockTimer);
    clearTimeout(flushTimer);
    resize.disconnect();
    study?.destroy();studyHost?.remove();clearInterval(captureTimer);clearInterval(photoTimer);chromeSizer.disconnect();tutor?.destroy();tutorHost?.remove();shapeHold.stop();selectionEditor?.destroy();imageEditor?.destroy();keyedImages.clear();root.removeEventListener('paste',pasteImage);root.removeEventListener('pointerdown',flushTapControl,true);finisher.destroy();unbindGestures();renderer.destroy();for(const d of disposables)d.destroy();
    stopMeter();
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("online", online);window.removeEventListener("offline",offline);
    window.removeEventListener("beforeunload", unload);
    document.body.classList.remove("lecture-open");window.visualViewport?.removeEventListener("resize",lectureViewport);window.visualViewport?.removeEventListener("scroll",lectureViewport);root.removeEventListener("selectstart",rejectSelection);root.removeEventListener("keydown",historyKey);root.removeEventListener("contextmenu",rejectSelection);root.style.removeProperty("--lecture-viewport-height");root.style.removeProperty("--lecture-viewport-top");
    releaseLock?.();
    store.close();
    throw e;
  }
  updateStatus();
  if(locked)void finisher.resume();
  void flush().catch(() => {});
  if(updateResume){await store.remove(resumeKey);if(updateResume.tutor)await toggleTutor();if(updateResume.slide)void showSlides(updateResume.slide.sourceId,updateResume.slide.sourcePage).catch(e=>toast(e.message));if(updateResume.resumeRecording&&locked){try{await beginRecording();}catch{modal('Resume lecture recording',el('div',{},el('p',{},'Your notes are saved. Tap to restart the microphone.'),quiet('Resume recording',run(async()=>{await beginRecording();document.querySelector('#dialog').close();}))));}}}
  if(routeQuery().get('source'))void showSlides(routeQuery().get('source'),Number(routeQuery().get('slide')||1)).catch(e=>toast(e.message));else if(!updateResume&&remote.item.data.lessonId)void showSlides().catch(e=>toast(e.message));
  if (routeQuery().get("record") === "1") {
    history.replaceState(null, "", "#" + route(course.id, id));
    if (locked) recordButton.click();
  }
  return {
    storeName:store.name,finished:()=>locallyFinished,
    finish:finishNow,syncPause,
    suspendView(){viewActive=false;void pauseLecture().catch(()=>{});document.body.classList.remove('lecture-open');if(slides?.element)slides.element.hidden=true;if(tutor?.element)tutor.element.hidden=true;},
    resumeView(){viewActive=true;chooseMode('pen');document.body.classList.add('lecture-open');sizePaper();if(slides?.element)slides.element.hidden=false;if(tutor?.element)tutor.element.hidden=false;if(routeQuery().get('source'))void showSlides(routeQuery().get('source'),Number(routeQuery().get('slide')||1)).catch(e=>toast(e.message));if(routeQuery().has('study')&&!studyHost)void toggleStudy().catch(e=>toast(e.message));},
    dirty: () => !updateReady && (!!drawing || dirty || unsavedLocal.size > 0 || !!localError || !!imageImporting || record.state === 'recording' || !!(record.emergencyChunks?.length && !record.emergencyAcknowledged)),
    beforeLeave: async () => {
      if(selectionEditor?.busy()){toast("Finish the selection before leaving.");return false;}
      if(imageImporting){toast("Wait for the image to finish saving before leaving.");return false;}
      imageEditor?.clear();
      if(tutor?.beforeLeave&&!await tutor.beforeLeave())return false;
      if (record.emergencyChunks?.length && !record.emergencyAcknowledged) {
        toast(
          "Export the emergency audio from Audio & details before closing this tab.",
        );
        return false;
      }
      await pauseLecture().catch(e=>{localError=e;});
      unbindGestures.flushPending();await penQueue;finishStroke();
      await persist().catch(() => {});
      for (const key of unsavedLocal) {
        try {
          await journalFor(key).retryLocal();
          unsavedLocal.delete(key);
        } catch (error) {
          localError = error;
          toast(
            "Export your notes before leaving. This device could not save them.",
          );
          return false;
        }
      }
      if (!unsavedLocal.size) localError = null;
      return !localError;
    },
    destroy() {
      dead = true;
      slides?.close();
      clearTimeout(flushTimer);
      clearInterval(clockTimer);
      stopMeter();
      resize.disconnect();
      study?.destroy();studyHost?.remove();clearInterval(captureTimer);clearInterval(photoTimer);chromeSizer.disconnect();tutor?.destroy();tutorHost?.remove();shapeHold.stop();selectionEditor?.destroy();imageEditor?.destroy();keyedImages.clear();root.removeEventListener('paste',pasteImage);root.removeEventListener('pointerdown',flushTapControl,true);finisher.destroy();unbindGestures();renderer.destroy();for(const d of disposables)d.destroy();
      record.release();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", online);window.removeEventListener("offline",offline);
      window.removeEventListener("beforeunload", unload);
      if (audioURL) URL.revokeObjectURL(audioURL);
      document.body.classList.remove("lecture-open");window.visualViewport?.removeEventListener("resize",lectureViewport);window.visualViewport?.removeEventListener("scroll",lectureViewport);root.removeEventListener("selectstart",rejectSelection);root.removeEventListener("keydown",historyKey);root.removeEventListener("contextmenu",rejectSelection);root.style.removeProperty("--lecture-viewport-height");root.style.removeProperty("--lecture-viewport-top");
      Promise.allSettled([persistence, flushPromise, record.flushPromise,finisher.settled()]).then(
        () => {
          releaseLock?.();
          store.close();
        },
      );
    },
  };
}
