import { makeGif } from "./gif-encoder.js";

(function () {
  "use strict";
  const $ = selector => document.querySelector(selector);
  const els = {
    video: $("#camera"), canvas: $("#previewCanvas"), empty: $("#cameraEmpty"), start: $("#startButton"), capture: $("#captureButton"), captureLabel: $("#captureLabel"),
    count: $("#frameCount"), play: $("#playButton"), save: $("#saveButton"), speed: $("#speedRange"),
    expandFrames: $("#expandFramesButton"), picturesDialog: $("#picturesDialog"),
    pictureBoard: $("#pictureBoard"), closePictures: $("#closePictures"), removeAll: $("#removeAllButton"), previousPicturePage: $("#previousPicturePage"), nextPicturePage: $("#nextPicturePage"), picturePageDots: $("#picturePageDots"),
    playbackDialog: $("#playbackDialog"), playbackCanvas: $("#playbackCanvas"), stopPlayback: $("#stopPlayback"),
    onion: $("#onionButton"), onionLayer: $("#onionLayer"), switchCamera: $("#switchButton"), toast: $("#toast"), countdown: $("#countdown"),
    frameActions: $("#frameActions"), selectedLabel: $("#selectedLabel"), redo: $("#redoButton"), remove: $("#deleteButton"), closeActions: $("#closeActions"),
    exportDialog: $("#exportDialog"),
    exporting: $("#exportingView"), exportDone: $("#exportDone"), progress: $("#exportProgress"), gifPreview: $("#gifPreview"), download: $("#downloadLink"), closeExport: $("#closeExport")
  };
  let frames = [], stream = null, facing = "environment", effect = "normal", selected = -1, replaceIndex = -1, playing = false, playTimer = null, previewIndex = 0, onion = false, currentGifUrl = null, deleteConfirm = false, removeAllConfirm = false, picturePage = 0;
  const CAPTURE_MAX_WIDTH = 960, GIF_MAX_WIDTH = 640, FRAME_JPEG_QUALITY = .92;
  const captureCanvas = document.createElement("canvas"), captureCtx = captureCanvas.getContext("2d", { willReadFrequently: true });
  const playCtx = els.playbackCanvas.getContext("2d");

  function announce(message) { els.toast.textContent = message; els.toast.classList.add("show"); clearTimeout(announce.timer); announce.timer = setTimeout(() => els.toast.classList.remove("show"), 1700); }
  function plural(n) { return `${n} picture${n === 1 ? "" : "s"}`; }
  function setButtons() { const has = frames.length > 0; els.play.disabled = !has; els.expandFrames.disabled = !has; els.save.disabled = frames.length < 2; els.onion.disabled = !has || !stream; els.count.textContent = plural(frames.length); }
  function boardPageSize() { return window.innerHeight <= 650 && window.innerWidth > window.innerHeight ? 8 : window.innerWidth <= 600 ? 9 : 12; }
  function updateLiveEffect() { els.video.dataset.effect = effect; }
  function openDialog(dialog) { if (!dialog.open) dialog.showModal(); }

  function waitForVideo() {
    if (els.video.readyState >= 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 4000);
      els.video.addEventListener("loadedmetadata", () => { clearTimeout(timer); resolve(); }, { once: true });
      els.video.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Video could not start")); }, { once: true });
    });
  }

  async function requestCamera() {
    const preferred = { video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
    try { return await navigator.mediaDevices.getUserMedia(preferred); }
    catch (error) {
      if (["NotAllowedError", "SecurityError"].includes(error.name)) throw error;
      // Firefox and some external webcams reject otherwise harmless optional
      // constraints. A plain request still gives the child a working camera.
      return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
  }

  async function startCameraIfAlreadyAllowed() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return;
    try {
      if (navigator.permissions?.query) {
        const permission = await navigator.permissions.query({ name: "camera" });
        if (permission.state === "granted") { await startCamera(); return; }
        if (permission.state === "prompt" || permission.state === "denied") return;
      }
    } catch (_) { /* Safari and older Firefox versions may not expose camera permission queries. */ }
    try {
      // Browsers generally expose device labels only after camera permission
      // has previously been granted, making this a prompt-free fallback.
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (devices.some(device => device.kind === "videoinput" && device.label)) await startCamera();
    } catch (_) { /* Keep the manual Start Camera button. */ }
  }

  async function startCamera() {
    if (!window.isSecureContext) {
      els.empty.querySelector("p").textContent = "The camera needs HTTPS, or localhost while testing.";
      announce("Open this page with HTTPS to use the camera");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) { announce("This browser cannot open the camera"); return; }
    if (stream) stream.getTracks().forEach(track => track.stop());
    try {
      stream = await requestCamera();
      els.video.srcObject = stream; await waitForVideo(); await els.video.play();
      els.empty.classList.add("hidden"); els.capture.disabled = false; els.switchCamera.disabled = false; setButtons(); updateOnion();
    } catch (error) { stream = null; els.empty.classList.remove("hidden"); announce(["NotAllowedError", "SecurityError"].includes(error.name) ? "Ask a grown-up to allow the camera" : "Camera could not start"); }
  }

  function dimensions(maxWidth = CAPTURE_MAX_WIDTH) {
    const sourceW = els.video.videoWidth || 1280, sourceH = els.video.videoHeight || 720, width = Math.min(maxWidth, sourceW);
    return { width: Math.round(width / 2) * 2, height: Math.round(width * sourceH / sourceW / 2) * 2 };
  }
  function applyEffect(ctx, width, height, chosen) {
    if (chosen === "normal") return;
    const image = ctx.getImageData(0, 0, width, height), d = image.data;
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      if (chosen === "mono") { const y = .299 * r + .587 * g + .114 * b; r = g = b = y > 145 ? Math.min(255, y * 1.12) : y * .82; }
      if (chosen === "pop") { const avg = (r + g + b) / 3; r = avg + (r - avg) * 1.55 + 8; g = avg + (g - avg) * 1.55 + 4; b = avg + (b - avg) * 1.55; }
      if (chosen === "comic") { r = Math.round(r / 48) * 48; g = Math.round(g / 48) * 48; b = Math.round(b / 48) * 48; }
      d[i] = Math.max(0, Math.min(255, r)); d[i + 1] = Math.max(0, Math.min(255, g)); d[i + 2] = Math.max(0, Math.min(255, b));
    }
    ctx.putImageData(image, 0, 0);
  }
  function canvasBlob(canvas, type = "image/jpeg", quality = FRAME_JPEG_QUALITY) {
    return new Promise(resolve => canvas.toBlob(async blob => {
      if (blob) resolve(blob);
      else resolve(await (await fetch(canvas.toDataURL(type, quality))).blob());
    }, type, quality));
  }

  async function decodeBlob(blob) {
    if (typeof createImageBitmap === "function") {
      try { const bitmap = await createImageBitmap(blob); return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }; }
      catch (_) { /* Fall through to the image-element decoder for Firefox. */ }
    }
    const url = URL.createObjectURL(blob), image = new Image(); image.decoding = "async"; image.src = url;
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("Picture could not be decoded")); });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  }
  async function snap() {
    if (!stream || playing) return;
    els.capture.disabled = true;
    els.countdown.textContent = "★"; els.countdown.classList.add("show");
    await new Promise(resolve => setTimeout(resolve, 180)); els.countdown.classList.remove("show");
    const { width, height } = dimensions(); captureCanvas.width = width; captureCanvas.height = height;
    if (facing === "user") { captureCtx.save(); captureCtx.translate(width, 0); captureCtx.scale(-1, 1); captureCtx.drawImage(els.video, 0, 0, width, height); captureCtx.restore(); }
    else captureCtx.drawImage(els.video, 0, 0, width, height);
    applyEffect(captureCtx, width, height, effect);
    const blob = await canvasBlob(captureCanvas), frame = { blob, url: URL.createObjectURL(blob), effect, created: Date.now() };
    if (replaceIndex >= 0) { URL.revokeObjectURL(frames[replaceIndex].url); frames.splice(replaceIndex, 1, frame); announce("Picture fixed!"); replaceIndex = -1; els.captureLabel.textContent = "Take a picture"; }
    else { frames.push(frame); announce(frames.length === 1 ? "Great first picture!" : `${frames.length} pictures — nice!`); }
    selected = -1; await persist(); renderFrames(); updateOnion(); els.capture.disabled = false;
  }

  function renderFrames() {
    els.frameActions.hidden = selected < 0; els.frameActions.closest("footer").classList.toggle("editing", selected >= 0); els.picturesDialog.classList.toggle("editing", selected >= 0); if (selected >= 0) els.selectedLabel.textContent = `Picture ${selected + 1}`;
    setButtons();
  }

  function renderPictureBoard() {
    els.pictureBoard.replaceChildren(); const pageSize = boardPageSize(), pageCount = Math.max(1, Math.ceil(frames.length / pageSize)); picturePage = Math.min(picturePage, pageCount - 1);
    const firstIndex = picturePage * pageSize;
    frames.slice(firstIndex, firstIndex + pageSize).forEach((frame, offset) => {
      const index = firstIndex + offset, button = document.createElement("button"); button.className = `board-frame${selected === index ? " selected" : ""}`; button.dataset.index = index; button.setAttribute("aria-label", `Open picture ${index + 1}`);
      const image = document.createElement("img"); image.src = frame.url; image.alt = ""; const number = document.createElement("span"); number.textContent = index + 1; button.append(image, number); els.pictureBoard.append(button);
    });
    const hasMultiplePages = pageCount > 1, footer = els.picturePageDots.closest("footer");
    els.picturePageDots.closest(".board-pagination").hidden = !hasMultiplePages; footer.classList.toggle("no-pagination", !hasMultiplePages); els.picturesDialog.classList.toggle("single-page", !hasMultiplePages);
    els.previousPicturePage.disabled = picturePage === 0; els.nextPicturePage.disabled = picturePage >= pageCount - 1;
    els.picturePageDots.textContent = Array.from({ length: pageCount }, (_, index) => index === picturePage ? "●" : "○").join(" ");
  }
  function resetDelete() { deleteConfirm = false; els.remove.classList.remove("confirm"); els.remove.innerHTML = '<svg><use href="#i-trash"/></svg> Remove'; }
  function resetRemoveAll() { removeAllConfirm = false; els.removeAll.classList.remove("confirm"); els.removeAll.innerHTML = '<svg><use href="#i-trash"/></svg><span>All</span>'; }
  function selectFrame(index) { resetDelete(); resetRemoveAll(); selected = selected === index ? -1 : index; renderFrames(); }
  async function deleteFrame() {
    if (selected < 0) return;
    if (!deleteConfirm) { deleteConfirm = true; els.remove.classList.add("confirm"); els.remove.innerHTML = '<svg><use href="#i-trash"/></svg><svg><use href="#i-trash"/></svg>'; announce("Tap the red button once more"); clearTimeout(deleteFrame.timer); deleteFrame.timer = setTimeout(resetDelete, 3000); return; }
    const number = selected + 1; resetDelete(); URL.revokeObjectURL(frames[selected].url); frames.splice(selected, 1); selected = -1; replaceIndex = -1;
    await persist(); renderFrames(); if (els.picturesDialog.open) renderPictureBoard(); updateOnion(); announce(`Picture ${number} removed`);
  }
  async function removeAllFrames() {
    if (!frames.length) return;
    if (!removeAllConfirm) { removeAllConfirm = true; els.removeAll.classList.add("confirm"); els.removeAll.innerHTML = '<svg><use href="#i-trash"/></svg><span>Again</span>'; announce("Tap the red All button once more"); clearTimeout(removeAllFrames.timer); removeAllFrames.timer = setTimeout(resetRemoveAll, 3000); return; }
    frames.forEach(frame => URL.revokeObjectURL(frame.url)); frames = []; selected = -1; replaceIndex = -1; picturePage = 0; resetDelete(); resetRemoveAll(); els.captureLabel.textContent = "Take a picture";
    await persist(); renderFrames(); updateOnion(); els.picturesDialog.close(); announce("All pictures removed");
  }
  function prepareRedo() { if (selected < 0) return; replaceIndex = selected; selected = -1; if (els.picturesDialog.open) els.picturesDialog.close(); els.captureLabel.textContent = `Fix picture ${replaceIndex + 1}`; renderFrames(); announce("Tap the big camera button"); }
  function updateOnion() { const last = frames.at(-1); els.onionLayer.style.display = onion && last && stream ? "block" : "none"; if (last) els.onionLayer.src = last.url; els.onion.setAttribute("aria-pressed", String(onion)); }

  function stopPlaying() {
    playing = false; clearTimeout(playTimer);
    if (document.fullscreenElement === els.playbackDialog) document.exitFullscreen().catch(() => {});
    if (els.playbackDialog.open) els.playbackDialog.close();
    els.play.innerHTML = '<svg><use href="#i-play"/></svg><span>Play</span>'; updateOnion();
  }
  async function drawFrame(frame) {
    const decoded = await decodeBlob(frame.blob); els.playbackCanvas.width = decoded.width; els.playbackCanvas.height = decoded.height; playCtx.drawImage(decoded.source, 0, 0); decoded.close();
  }
  async function playNext() {
    if (!playing || !frames.length) return; await drawFrame(frames[previewIndex]); if (!playing) return; previewIndex = (previewIndex + 1) % frames.length;
    playTimer = setTimeout(playNext, 1000 / Number(els.speed.value));
  }
  function togglePlay() {
    if (playing) { stopPlaying(); return; } playing = true; previewIndex = 0; openDialog(els.playbackDialog); els.onionLayer.style.display = "none";
    if (document.fullscreenEnabled && els.playbackDialog.requestFullscreen) els.playbackDialog.requestFullscreen().catch(() => {});
    els.play.innerHTML = '<svg><use href="#i-pause"/></svg><span>Stop</span>'; playNext();
  }

  async function exportGif() {
    if (frames.length < 2) return; if (playing) stopPlaying();
    els.exporting.hidden = false; els.exportDone.hidden = true; els.progress.value = 0; openDialog(els.exportDialog);
    await new Promise(resolve => setTimeout(resolve, 80));
    const first = await decodeBlob(frames[0].blob), width = Math.round(Math.min(GIF_MAX_WIDTH, first.width) / 2) * 2, height = Math.round(width * first.height / first.width / 2) * 2; first.close();
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true }); canvas.width = width; canvas.height = height; const rgbaFrames = [];
    for (let i = 0; i < frames.length; i++) { const decoded = await decodeBlob(frames[i].blob); ctx.drawImage(decoded.source, 0, 0, width, height); decoded.close(); rgbaFrames.push(ctx.getImageData(0, 0, width, height).data); els.progress.value = (i / frames.length) * 35; await new Promise(resolve => setTimeout(resolve, 0)); }
    const delay = 1000 / Number(els.speed.value); const gif = makeGif(rgbaFrames, width, height, delay, value => { els.progress.value = 35 + value * 65; });
    if (currentGifUrl) URL.revokeObjectURL(currentGifUrl); currentGifUrl = URL.createObjectURL(gif); els.gifPreview.src = currentGifUrl; els.download.href = currentGifUrl;
    els.exporting.hidden = true; els.exportDone.hidden = false;
  }

  function openDb() { return new Promise((resolve, reject) => { const request = indexedDB.open("wiggle-studio", 1); request.onupgradeneeded = () => request.result.createObjectStore("project"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
  async function persist() { try { const db = await openDb(), tx = db.transaction("project", "readwrite"); tx.objectStore("project").put(frames.map(f => ({ blob: f.blob, effect: f.effect, created: f.created })), "frames"); tx.objectStore("project").put(Number(els.speed.value), "speed"); } catch (_) { /* The app still works if private browsing blocks storage. */ } }
  async function restore() { try { const db = await openDb(), tx = db.transaction("project", "readonly"), store = tx.objectStore("project"); const frameRequest = store.get("frames"), speedRequest = store.get("speed"); const saved = await new Promise(resolve => { frameRequest.onsuccess = () => resolve(frameRequest.result || []); frameRequest.onerror = () => resolve([]); }); const savedSpeed = await new Promise(resolve => { speedRequest.onsuccess = () => resolve(speedRequest.result); speedRequest.onerror = () => resolve(null); }); frames = saved.map(f => ({ ...f, url: URL.createObjectURL(f.blob) })); if (savedSpeed) els.speed.value = savedSpeed; renderFrames(); updateOnion(); } catch (_) { renderFrames(); } }

  els.start.addEventListener("click", startCamera); els.capture.addEventListener("click", snap); els.play.addEventListener("click", togglePlay); els.save.addEventListener("click", exportGif);
  els.expandFrames.addEventListener("click", () => { resetRemoveAll(); picturePage = Math.floor(Math.max(0, selected) / boardPageSize()); renderPictureBoard(); openDialog(els.picturesDialog); });
  els.closePictures.addEventListener("click", () => { selected = -1; resetDelete(); resetRemoveAll(); renderFrames(); els.picturesDialog.close(); }); els.removeAll.addEventListener("click", removeAllFrames); els.previousPicturePage.addEventListener("click", () => { selected = -1; resetDelete(); resetRemoveAll(); picturePage--; renderFrames(); renderPictureBoard(); }); els.nextPicturePage.addEventListener("click", () => { selected = -1; resetDelete(); resetRemoveAll(); picturePage++; renderFrames(); renderPictureBoard(); });
  els.pictureBoard.addEventListener("click", event => { const frame = event.target.closest(".board-frame"); if (!frame) return; selectFrame(Number(frame.dataset.index)); renderPictureBoard(); });
  els.picturesDialog.addEventListener("close", () => { resetRemoveAll(); if (selected >= 0) { selected = -1; resetDelete(); renderFrames(); } });
  els.stopPlayback.addEventListener("click", stopPlaying); els.playbackDialog.addEventListener("cancel", event => { event.preventDefault(); stopPlaying(); });
  els.redo.addEventListener("click", prepareRedo); els.remove.addEventListener("click", deleteFrame); els.closeActions.addEventListener("click", () => { selected = -1; resetDelete(); renderFrames(); renderPictureBoard(); });
  els.onion.addEventListener("click", () => { onion = !onion; updateOnion(); announce(onion ? "Ghost picture on" : "Ghost picture off"); });
  els.switchCamera.addEventListener("click", async () => { facing = facing === "environment" ? "user" : "environment"; await startCamera(); announce("Camera flipped"); });
  document.querySelectorAll(".effect").forEach(button => button.addEventListener("click", () => { document.querySelectorAll(".effect").forEach(b => { b.classList.toggle("active", b === button); b.setAttribute("aria-pressed", String(b === button)); }); effect = button.dataset.effect; updateLiveEffect(); announce(`${button.textContent.trim()} style`); }));
  els.speed.addEventListener("change", persist);
  els.closeExport.addEventListener("click", () => els.exportDialog.close()); window.addEventListener("resize", () => { renderFrames(); if (els.picturesDialog.open) renderPictureBoard(); }); window.addEventListener("beforeunload", () => stream?.getTracks().forEach(track => track.stop()));
  updateLiveEffect(); restore(); startCameraIfAlreadyAllowed();
})();
