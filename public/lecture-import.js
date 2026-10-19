import {slidePageSelection} from './lecture-slide-range.js';
import { el, button, modal, toast, select } from "./ui.js";
import {bindSlideInteractions} from './lecture-slide-interactions.js';
import {controlIcon} from './quiet-controls.js';
import { slideDock } from './lecture-slide-dock.js';
import {
  driveId,
  SOURCE_LIMITS,
  validateBackground,
  yellowReviewRegions,
} from "./lecture-sources.js";
const quiet = (s, f) =>
  button(
    s,
    () =>
      Promise.resolve()
        .then(f)
        .catch((e) => toast(e.message)),
    "quiet compact",
  );
async function hash(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export async function openLectureSources({ ctx, id, store, addBackground, addImage, onSourceChange, defaultRole="notes" }) {
  const base = `/api/lectures/${id}/sources/`,
    body = el("div"),
    list = el("div"),
    link = el("input", {
      type: "url",
      placeholder: "Private Google Drive file link",
    }),
    role = select(
      "Use as",
      [
        { value: "notes", label: "Notes" },
        { value: "slides", label: "Slides as PDF" },
        { value: "recording", label: "Audio or screen recording" },
      ],
      defaultRole,
    );
  let pending = null;
  const attach = quiet("Attach Drive file", async () => {
    const fileId = driveId(link.value);
    if (
      !pending ||
      pending.fileId !== fileId ||
      pending.role !== role.input.value
    )
      pending = {
        fileId,
        role: role.input.value,
        mutationId: crypto.randomUUID(),
      };
    const result = await ctx.request(base + "drive", {
      method: "POST",
      body: pending,
    });
    if (!result?.item)
      throw Error(
        "Attachment is not confirmed saved. Retry when LifeOS is available.",
      );
    pending = null;
    link.value = "";
    await refresh();
    onSourceChange?.();
  });
  body.append(
    el(
      "p",
      {},
      "Keep backup recordings and notes in private Drive files. Attach them here when LifeOS is available.",
    ),
    el("label", {}, "File", link),
    role.node,
    attach,
    list,
  );
  const dialog = modal("Notes, slides & backup recording", body);
  async function refresh() {
    let items;
    try {
      items = (await ctx.request(base + "list")).items;
      await store?.put("sources:" + id, items);
    } catch (e) {
      items = await store?.get("sources:" + id);
      if (!items) throw e;
      toast("Showing saved source references. Cloud access needs retry.");
    }
    list.replaceChildren();
    for (const item of items) {
      const source = item.data,
        url = base + item.id + "/0";
      list.append(
        el(
          "section",
          { class: "lecture-source-row" },
          el("h3", {}, source.title),
          el(
            "p",
            {},
            source.role === "recording"
              ? "Original recording · Note timing has not been mapped"
              : "Original retained in Drive",
          ),
          quiet(
            source.role === "recording" ? "Play recording" : "Open / crop",
            async () => {
              if (source.role === "recording") {
                const media = el(
                  source.mimeType.startsWith("video/") ? "video" : "audio",
                  {
                    controls: true,
                    preload: "metadata",
                    src: url,
                    class: "lecture-import-media",
                  },
                );
                modal(
                  source.title,
                  el(
                    "div",
                    {},
                    media,
                    el(
                      "p",
                      {},
                      "Imported image notes have no stroke timestamps. Playback does not claim an automatic note-to-audio match.",
                    ),
                  ),
                  {
                    onclose: () => {
                      media.pause();
                      media.removeAttribute("src");
                      media.load();
                    },
                  },
                );
              } else {
                const response = await fetch(url, {
                  credentials: "same-origin",
                });
                if (!response.ok)
                  throw Error(
                    "Source unavailable. The original is still in Drive.",
                  );
                const data = await response.arrayBuffer();
                if (data.byteLength > SOURCE_LIMITS.document)
                  throw Error("Source is too large.");
                await openSourceCrop({
                  bytes: data,
                  mimeType: source.mimeType,
                  name: source.title,
                  sourceId: item.id,
                  addBackground: async (bg,dimensions) => {
                    await (source.mimeType.startsWith('image/')&&addImage?addImage:addBackground)(bg,dimensions);
                  },
                });
              }
            },
          ),
        ),
      );
    }
  }
  await refresh();
  return dialog;
}

// One page/crop at a time; no document script, annotation action or remote font runs.
export async function openSourceCrop({
  initialPage,
  bytes,
  mimeType,
  name,
  sourceId = "",
  addBackground,
  floating = false,
  addCrop,
  openNotebook,
  onCurrent,
  pageRange,
}) {
  if (bytes.byteLength > SOURCE_LIMITS.document)
    throw Error("Use a source smaller than 24 MB.");
  const sourceHash = await hash(bytes);
  let pdf = null,
    image = null,
    pageNumber = 1,
    total = 1,
    rect = [0, 0, 1, 1],
    drag = null,
    dead = false,
    renderTask = null,
    cropMode = !floating,
    tapStart = null,
    inserting = false, bulk=false, unbindSlideGestures=null;
  let allowedPages=[],lessonPages=[];
  const highlight = el("input", { type: "checkbox" });
  const canvas = el("canvas", {
      class: "lecture-crop-canvas",
      "aria-label": "Drag a rectangle to crop the source",
    }),
    c = canvas.getContext("2d"),
    raster = document.createElement("canvas"),
    label = el("span"),
    status = el(
      "p",
      {},
      "Drag to crop, or use the whole page. The original stays unchanged.",
    ),
    buttons = el("div", { class: "actions" });
  async function redraw() {
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.drawImage(raster, 0, 0);
    if (rect.some((x, i) => x !== [0, 0, 1, 1][i])) {
      c.strokeStyle = "#246bb0";
      c.lineWidth = 3;
      c.strokeRect(
        rect[0] * canvas.width,
        rect[1] * canvas.height,
        rect[2] * canvas.width,
        rect[3] * canvas.height,
      );
    }
  }
  async function render() {
    if (dead) return;
    buttons.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      if (pdf) {
        const p = await pdf.getPage(pageNumber),
          natural = p.getViewport({ scale: 1 }),
          v = p.getViewport({
            scale: Math.min(1600 / natural.width, 2200 / natural.height),
          });
        raster.width = Math.ceil(v.width);
        raster.height = Math.ceil(v.height);
        renderTask = p.render({
          canvasContext: raster.getContext("2d"),
          viewport: v,
          annotationMode: 0,
        });
        await renderTask.promise;
        renderTask = null;
        let text='';try{text=(await p.getTextContent()).items.map(x=>x.str??'').join(' ').slice(0,16000);}catch{}const preview=document.createElement('canvas'),factor=Math.min(1,900/raster.width);preview.width=Math.round(raster.width*factor);preview.height=Math.round(raster.height*factor);preview.getContext('2d').drawImage(raster,0,0,preview.width,preview.height);const image=preview.toDataURL('image/jpeg',.65);onCurrent?.({sourceId,sourceHash,pageNumber,title:name,text,...(image.length<=240000?{image}:{})});
        p.cleanup();
      } else {
        const scale = Math.min(1, 1600 / image.width, 5000 / image.height);
        raster.width = Math.round(image.width * scale);
        raster.height = Math.round(image.height * scale);
        raster
          .getContext("2d")
          .drawImage(image, 0, 0, raster.width, raster.height);
      }
      canvas.width = raster.width;
      canvas.height = raster.height;
      rect = [0, 0, 1, 1];
      label.textContent = `Page ${pageNumber} of ${total}`;
      await redraw();
    } finally {
      buttons.querySelectorAll("button").forEach((b) => (b.disabled = bulk));
    }
  }
  const present = floating ? (title,body,options) => slideDock(title,body,options.onclose) : modal;
  const dialog = present(
    name,
    el(
      "div",
      {},
      buttons,
      status,
      floating ? null : el(
        "label",
        {},
        highlight,
        "Yellow highlights mark things I do not understand",
      ),
      canvas,
    ),
    {
      onclose: () => {
        dead = true;
        unbindSlideGestures?.();
        renderTask?.cancel();
        void pdf?.destroy();
        image?.close?.();
      },
    },
  );
  buttons.append(
    Object.assign(quiet(floating ? "‹" : "Previous page", async () => {
      if (allowedPages.indexOf(pageNumber) > 0) {
        pageNumber=allowedPages[allowedPages.indexOf(pageNumber)-1];
        await render();
      }
    }), {ariaLabel:'Previous slide'}),
    label,
    Object.assign(quiet(floating ? "›" : "Next page", async () => {
      if (allowedPages.indexOf(pageNumber) < allowedPages.length-1) {
        pageNumber=allowedPages[allowedPages.indexOf(pageNumber)+1];
        await render();
      }
    }), {ariaLabel:'Next slide'}),
    ...(!floating ? [quiet("Whole page", async () => {
      rect = [0, 0, 1, 1];
      await redraw();
    }), quiet("Add as note page", async () => {
      await insert(false);
    })] : []),
  );
  async function insert(paste) {
      if(dead||inserting)return;
      inserting=true;
      buttons.querySelectorAll('button').forEach(b=>b.disabled=true);
      try {
      const [x, y, w, h] = rect,
        out = document.createElement("canvas"),
        scale = Math.min(
          1,
          1500 / (raster.width * w),
          2100 / (raster.height * h),
        );
      out.width = Math.max(1, Math.round(raster.width * w * scale));
      out.height = Math.max(1, Math.round(raster.height * h * scale));
      out
        .getContext("2d")
        .drawImage(
          raster,
          x * raster.width,
          y * raster.height,
          w * raster.width,
          h * raster.height,
          0,
          0,
          out.width,
          out.height,
        );
      let dataUrl = out.toDataURL("image/jpeg", 0.88);
      if (dataUrl.length > 480000) dataUrl = out.toDataURL("image/jpeg", 0.65);
      const bg = validateBackground({
        dataUrl,
        sourceName: name.slice(0, 220),
        sourceId,
        sourceHash,
        sourcePage: pageNumber,
        crop: rect,
        ...(highlight.checked
          ? {
              reviewRegions: yellowReviewRegions(
                out.getContext("2d").getImageData(0, 0, out.width, out.height),
              ),
            }
          : {}),
      });
      if(paste) await addCrop(bg, {width:out.width,height:out.height});
      else await addBackground(bg,{width:out.width,height:out.height});
      if(!floating)dialog.close();
      else status.textContent=paste?'Crop added to your notes.':'Slide open on the paper. Write with your Pencil.';
      }finally{inserting=false;if(!dead&&!bulk)buttons.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  if(floating) {
    status.textContent='';
    buttons.append(quiet('Crop',()=>{}));
    const cropButton=buttons.lastElementChild;
    const pasteButton=quiet('Paste into notes',async()=>{if(!cropMode)throw Error('Select Crop and drag over the slide first.');await insert(true);});pasteButton.hidden=true;
    cropButton.onclick=()=>{cropMode=!cropMode;pasteButton.hidden=!cropMode;cropButton.setAttribute('aria-pressed',String(cropMode));canvas.style.touchAction=cropMode?'none':'pan-y';status.textContent=cropMode?'Drag over the part you want, then paste.':'';};
    buttons.append(pasteButton);
    canvas.setAttribute('role','button');canvas.tabIndex=0;canvas.setAttribute('aria-label','Lecture slide. Tap edges or swipe to turn. Double tap to open the lesson on your paper.');
    canvas.addEventListener('keydown',e=>{if(!cropMode&&['Enter',' '].includes(e.key)){e.preventDefault();rect=[0,0,1,1];void addPages(lessonPages).catch(e=>toast(e.message));}});
    canvas.style.touchAction='pan-y';
    const menu=quiet(controlIcon('more'),insertionMenu);menu.setAttribute('aria-label','Add slides to notebook');buttons.append(menu);
    unbindSlideGestures=bindSlideInteractions(canvas,action=>{if(cropMode||inserting||bulk)return;void (async()=>{if(action==='open')await addPages([pageNumber]);else if(action==='insert-menu')insertionMenu();else{const i=allowedPages.indexOf(pageNumber)+(action==='next'?1:-1);if(allowedPages[i]){pageNumber=allowedPages[i];await render();}}})().catch(e=>toast(e.message));});
  }

  async function addPages(numbers){if(inserting||bulk||dead)return;bulk=true;buttons.querySelectorAll('button').forEach(b=>b.disabled=true);try{const ordered=allowedPages.filter(n=>numbers.includes(n));if(!ordered.length)throw Error('Select at least one slide.');const initial=pageNumber;for(const number of ordered){if(dead)break;pageNumber=number;await render();rect=[0,0,1,1];await insert(false);}if(!dead){pageNumber=initial;await render();await openNotebook?.({sourceId,sourceHash,pageNumber:ordered.includes(initial)?initial:ordered[0]});status.textContent='';}}finally{bulk=false;if(!dead)buttons.querySelectorAll('button').forEach(b=>b.disabled=false);}}
  function insertionMenu(){modal('Add slides',el('div',{class:'form-stack'},quiet('All lesson slides',async()=>{document.querySelector('#dialog').close();await addPages(lessonPages);}),quiet('Current slide',async()=>{document.querySelector('#dialog').close();await addPages([pageNumber]);}),quiet('Choose slides',chooseSlides)));}
  async function chooseSlides(){const chosen=new Set([pageNumber]),grid=el('div',{class:'slide-pick-grid'}),counter=el('span',{},'1 selected'),body=el('div',{},grid),picker=modal('Choose slides',body);let cursor=0,cancelled=false;const more=quiet('More slides',loadMore),add=quiet('Add selected',async()=>{cancelled=true;picker.close();await addPages([...chosen]);});body.append(el('div',{class:'slide-pick-actions'},counter,more,add));const previousClose=picker.onclose;picker.onclose=()=>{if(picker.open)return;cancelled=true;previousClose?.();};
   async function loadMore(){more.disabled=true;const end=Math.min(cursor+24,allowedPages.length);while(cursor<end&&!cancelled){const n=allowedPages[cursor++],thumb=document.createElement('canvas');if(pdf){const p=await pdf.getPage(n),v=p.getViewport({scale:240/p.getViewport({scale:1}).width});thumb.width=Math.ceil(v.width);thumb.height=Math.ceil(v.height);await p.render({canvasContext:thumb.getContext('2d'),viewport:v,annotationMode:0}).promise;p.cleanup();}else{thumb.width=240;thumb.height=Math.round(image.height*240/image.width);thumb.getContext('2d').drawImage(image,0,0,thumb.width,thumb.height);}const tile=quiet(el('span',{},el('img',{src:thumb.toDataURL('image/jpeg',.7),alt:''}),el('span',{},'Slide '+n)),()=>{if(chosen.has(n))chosen.delete(n);else chosen.add(n);tile.setAttribute('aria-pressed',String(chosen.has(n)));counter.textContent=chosen.size+' selected';add.disabled=!chosen.size;});tile.setAttribute('aria-pressed',String(chosen.has(n)));tile.setAttribute('aria-label','Slide '+n);grid.append(tile);}more.disabled=false;more.hidden=cursor>=allowedPages.length;}
   await loadMore();
  }
  const point = (e) => {
    const b = canvas.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)),
      Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)),
    ];
  };
  canvas.addEventListener("pointerdown", (e) => {
    if(!cropMode){tapStart={x:e.clientX,y:e.clientY};return;}
    drag = point(e);
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const [x, y] = point(e);
    rect = [
      Math.min(x, drag[0]),
      Math.min(y, drag[1]),
      Math.abs(x - drag[0]),
      Math.abs(y - drag[1]),
    ];
    void redraw();
  });
  const finish = () => {
    drag = null;
    if (rect[2] < 0.01 || rect[3] < 0.01) rect = [0, 0, 1, 1];
    void redraw();
  };
  canvas.addEventListener("pointerup", e=>{
    // Tap/swipe/multiple-tap intent is resolved by bindSlideInteractions.
    tapStart=null;finish();
  });
  canvas.addEventListener("pointercancel", ()=>{tapStart=null;finish();});
  try {
    if (mimeType === "application/pdf") {
      const lib = await import("./vendor/pdfjs/pdf.mjs");
      lib.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.mjs",import.meta.url).href;
      pdf = await lib.getDocument({
        data: new Uint8Array(bytes),
        isEvalSupported: false,
        useSystemFonts: true,
        disableFontFace: true,
        maxImageSize: 16000000,
        isOffscreenCanvasSupported: false,
      }).promise;
      total = pdf.numPages;
    } else if (["image/png", "image/jpeg"].includes(mimeType)) {
      image = await createImageBitmap(new Blob([bytes], { type: mimeType }));
      if (image.width * image.height > 32000000)
        throw Error("Image dimensions exceed the note import limit.");
    } else throw Error("Use a PDF, PNG or JPEG.");
    const selection=slidePageSelection(total,pageRange,initialPage);allowedPages=selection.browsePages;lessonPages=selection.lessonPages;pageNumber=selection.initialPage;
    await render();
  } catch (e) {
    status.textContent = e.message;
    buttons.querySelectorAll("button").forEach((b) => (b.disabled = true));
  }
  return dialog;
}
