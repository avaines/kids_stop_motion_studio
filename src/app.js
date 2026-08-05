import { makeGif } from "./gif-encoder.js";

(function () {
  "use strict";
  const $ = selector => document.querySelector(selector);
  const els = {
    video: $("#camera"), canvas: $("#previewCanvas"), empty: $("#cameraEmpty"), start: $("#startButton"), capture: $("#captureButton"), captureLabel: $("#captureLabel"),
    strip: $("#frameStrip"), emptyTimeline: $("#emptyTimeline"), count: $("#frameCount"), play: $("#playButton"), save: $("#saveButton"), speed: $("#speedRange"),
    onion: $("#onionButton"), onionLayer: $("#onionLayer"), switchCamera: $("#switchButton"), toast: $("#toast"), countdown: $("#countdown"),
    frameActions: $("#frameActions"), selectedLabel: $("#selectedLabel"), redo: $("#redoButton"), remove: $("#deleteButton"), closeActions: $("#closeActions"),
    help: $("#helpDialog"), helpButton: $("#helpButton"), closeHelp: $("#closeHelp"), gotIt: $("#gotItButton"), exportDialog: $("#exportDialog"),
    exporting: $("#exportingView"), exportDone: $("#exportDone"), progress: $("#exportProgress"), gifPreview: $("#gifPreview"), download: $("#downloadLink"), closeExport: $("#closeExport")
  };
  let frames = [], stream = null, facing = "environment", effect = "normal", selected = -1, replaceIndex = -1, playing = false, playTimer = null, previewIndex = 0, onion = false, currentGifUrl = null, deleteConfirm = false;
  const captureCanvas = document.createElement("canvas"), captureCtx = captureCanvas.getContext("2d", { willReadFrequently: true });
  const playCtx = els.canvas.getContext("2d");

  function announce(message) { els.toast.textContent = message; els.toast.classList.add("show"); clearTimeout(announce.timer); announce.timer = setTimeout(() => els.toast.classList.remove("show"), 1700); }
  function plural(n) { return `${n} picture${n === 1 ? "" : "s"}`; }
  function setButtons() { const has = frames.length > 0; els.play.disabled = !has; els.save.disabled = frames.length < 2; els.onion.disabled = !has || !stream; els.count.textContent = plural(frames.length); }
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

  function dimensions(maxWidth = 640) {
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
  function canvasBlob(canvas, type = "image/jpeg", quality = .86) {
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
    els.strip.querySelectorAll(".frame").forEach(node => node.remove());
    els.emptyTimeline.hidden = frames.length > 0;
    frames.forEach((frame, index) => {
      const button = document.createElement("button"); button.className = `frame${selected === index ? " selected" : ""}${index === frames.length - 1 ? " is-last" : ""}`;
      button.dataset.index = index; button.setAttribute("aria-label", `Picture ${index + 1}. Tap for options.`);
      const image = document.createElement("img"); image.src = frame.url; image.alt = "";
      const number = document.createElement("span"); number.className = "number"; number.textContent = index + 1;
      button.append(image, number); els.strip.append(button);
    });
    els.frameActions.hidden = selected < 0; if (selected >= 0) els.selectedLabel.textContent = `Picture ${selected + 1}`;
    setButtons();
  }
  function resetDelete() { deleteConfirm = false; els.remove.innerHTML = '<svg><use href="#i-trash"/></svg> Remove'; }
  function selectFrame(index) { resetDelete(); selected = selected === index ? -1 : index; renderFrames(); if (selected >= 0) els.strip.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }); }
  async function deleteFrame() {
    if (selected < 0) return;
    if (!deleteConfirm) { deleteConfirm = true; els.remove.textContent = "Tap again to remove"; announce("One more tap to remove it"); clearTimeout(deleteFrame.timer); deleteFrame.timer = setTimeout(resetDelete, 3000); return; }
    const number = selected + 1; resetDelete(); URL.revokeObjectURL(frames[selected].url); frames.splice(selected, 1); selected = -1; replaceIndex = -1;
    await persist(); renderFrames(); updateOnion(); announce(`Picture ${number} removed`);
  }
  function prepareRedo() { if (selected < 0) return; replaceIndex = selected; selected = -1; els.captureLabel.textContent = `Fix picture ${replaceIndex + 1}`; renderFrames(); announce("Tap the big camera button"); }
  function updateOnion() { const last = frames.at(-1); els.onionLayer.style.display = onion && last && stream ? "block" : "none"; if (last) els.onionLayer.src = last.url; els.onion.setAttribute("aria-pressed", String(onion)); }

  function stopPlaying() { playing = false; clearTimeout(playTimer); els.canvas.style.display = "none"; els.video.style.display = "block"; els.play.innerHTML = '<svg><use href="#i-play"/></svg><span>Play</span>'; updateOnion(); }
  async function drawFrame(frame) {
    const decoded = await decodeBlob(frame.blob); els.canvas.width = decoded.width; els.canvas.height = decoded.height; playCtx.drawImage(decoded.source, 0, 0); decoded.close();
  }
  async function playNext() {
    if (!playing || !frames.length) return; await drawFrame(frames[previewIndex]); previewIndex = (previewIndex + 1) % frames.length;
    playTimer = setTimeout(playNext, 1000 / Number(els.speed.value));
  }
  function togglePlay() {
    if (playing) { stopPlaying(); return; } playing = true; previewIndex = 0; els.video.style.display = "none"; els.canvas.style.display = "block"; els.onionLayer.style.display = "none";
    els.play.innerHTML = '<svg><use href="#i-pause"/></svg><span>Stop</span>'; playNext();
  }

  async function exportGif() {
    if (frames.length < 2) return; if (playing) stopPlaying();
    els.exporting.hidden = false; els.exportDone.hidden = true; els.progress.value = 0; openDialog(els.exportDialog);
    await new Promise(resolve => setTimeout(resolve, 80));
    const first = await decodeBlob(frames[0].blob), maxW = 480, width = Math.round(Math.min(maxW, first.width) / 2) * 2, height = Math.round(width * first.height / first.width / 2) * 2; first.close();
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
  els.strip.addEventListener("click", event => { const frame = event.target.closest(".frame"); if (frame) selectFrame(Number(frame.dataset.index)); });
  els.redo.addEventListener("click", prepareRedo); els.remove.addEventListener("click", deleteFrame); els.closeActions.addEventListener("click", () => { selected = -1; renderFrames(); });
  els.onion.addEventListener("click", () => { onion = !onion; updateOnion(); announce(onion ? "Ghost picture on" : "Ghost picture off"); });
  els.switchCamera.addEventListener("click", async () => { facing = facing === "environment" ? "user" : "environment"; await startCamera(); announce("Camera flipped"); });
  document.querySelectorAll(".effect").forEach(button => button.addEventListener("click", () => { document.querySelectorAll(".effect").forEach(b => { b.classList.toggle("active", b === button); b.setAttribute("aria-pressed", String(b === button)); }); effect = button.dataset.effect; updateLiveEffect(); announce(`${button.textContent.trim()} style`); }));
  els.speed.addEventListener("change", persist); els.helpButton.addEventListener("click", () => openDialog(els.help)); els.closeHelp.addEventListener("click", () => els.help.close()); els.gotIt.addEventListener("click", () => els.help.close());
  els.closeExport.addEventListener("click", () => els.exportDialog.close()); window.addEventListener("beforeunload", () => stream?.getTracks().forEach(track => track.stop()));
  updateLiveEffect(); restore();
  try { if (!localStorage.getItem("wiggle-welcomed")) { setTimeout(() => openDialog(els.help), 350); localStorage.setItem("wiggle-welcomed", "yes"); } } catch (_) { /* Storage may be unavailable in private browsing. */ }
})();
