import { recordEvent } from './diagnostics.js';

const byId = (id) => document.getElementById(id);
const REF_MODES = ['corner', 'overlay', 'off'];
const REF_LABELS = { corner: '角落图', overlay: '叠加', off: '隐藏' };
const REF_HINTS = { corner: '参考图：角落小图', overlay: '参考图：叠在画面上', off: '参考图：已隐藏' };
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' };
const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' };
const MESSAGES = {
  insecure: '当前地址不能直接打开相机。请改用 HTTPS 或 localhost 打开页面，或改用“系统相机”拍。',
  unsupported: '当前浏览器不支持网页相机。可以改用“系统相机”拍。',
  denied: '没有相机权限。请在浏览器设置里允许使用相机后重试，或改用“系统相机”拍。',
  missing: '没有找到可用的相机。可以改用“系统相机”拍。',
  busy: '相机被其他应用占用，或暂时无法启动。关闭其他使用相机的应用后重试。',
  play: '浏览器没有让相机画面开始播放。请点“重试相机”，或改用“系统相机”拍。',
  other: '相机启动失败。请重试，或改用“系统相机”拍。',
  lost: '相机已断开。请重试，或改用“系统相机”拍。',
};
const GALLERY_DATA_URL = '../reference-library/photo-pose-gallery.json';
const GALLERY_IMAGE_ROOT = '../reference-library/poses-shisei-v0.4.1/';
const GALLERY_IMAGE_PATH = /^(std|upper)\/line\/[A-Za-z0-9_]+\.webp$/;
const POSTURE_LABELS = { standing: '站姿', sitting: '坐姿', squatting: '蹲姿', lying: '躺姿', upper: '半身动作' };
const ANGLE_LABELS = { front: '正面', diag: '斜侧', side: '侧面', back: '背面', above: '俯视', below: '仰视' };
const PICKER_PAGE = 18;
const TIMERS = [0, 3, 10];
const SETTINGS_KEY = 'pose-notes-camera-v1';
const ASPECTS = new Set(['source', '3:4', '4:3', '1:1', '16:9']);
const QUALITIES = [0.8, 0.92, 0.98];
const BURST_COUNTS = [1, 3, 5];
const BURST_INTERVALS = [500, 800, 1500];
const REF_OFFSET_LIMIT = 0.35;
const FRONT_NOTE = '前置镜头的预览是镜像的；保存是否镜像可在相机设置里改。';
const SAVE_NOTE = '已请求保存。请到浏览器的下载列表或相册里确认；没找到就用分享。';

const state = {
  pose: null, opener: null, stream: null, facing: 'environment', token: 0,
  phase: 'idle', errorKey: '', refMode: 'corner', hasRef: false, blob: null, url: '', name: '', capturing: false,
  delay: 0, countdown: null, countdownTimer: null, countdownStart: 0, gridOn: false,
  settings: readCameraSettings(), compare: false,
  shots: [], selected: 0, reviewToken: 0, burstTimer: null, burstResolve: null, dataReader: null,
  refDragging: false, drag: null,
};
const IMAGE_NAME = /\.(jpe?g|png|webp|heic|heif)$/i;
const picker = { loaded: false, entries: [], limit: PICKER_PAGE, request: 0, scrollNeeded: false };
let wired = false;

function showNotice(text) {
  const notice = byId('shoot-message');
  notice.textContent = text;
  notice.hidden = !text;
}

function typeFor(name, fallback = '') {
  const extension = IMAGE_NAME.exec(name)?.[1]?.toLowerCase();
  return (extension && TYPES[extension]) || fallback || 'image/jpeg';
}

function clampOffset(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(REF_OFFSET_LIMIT, Math.max(-REF_OFFSET_LIMIT, number)) : 0;
}

function readCameraSettings() {
 const defaults = { aspect: 'source', quality: 0.92, mirrorSave: false, refOpacity: 0.45, refScale: 1, refX: 0, refY: 0, refLocked: false, burstCount: 1, burstInterval: 800 };
 try {
  const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
  if (!raw || typeof raw !== 'object') return defaults;
  return {
   aspect: ASPECTS.has(raw.aspect) ? raw.aspect : defaults.aspect,
   quality: QUALITIES.includes(Number(raw.quality)) ? Number(raw.quality) : defaults.quality,
   mirrorSave: Boolean(raw.mirrorSave),
   refOpacity: Number(raw.refOpacity) >= 0.15 && Number(raw.refOpacity) <= 0.9 ? Number(raw.refOpacity) : defaults.refOpacity,
   refScale: Number(raw.refScale) >= 0.6 && Number(raw.refScale) <= 1.4 ? Number(raw.refScale) : defaults.refScale,
   refX: clampOffset(raw.refX),
   refY: clampOffset(raw.refY),
   refLocked: Boolean(raw.refLocked),
   burstCount: BURST_COUNTS.includes(Number(raw.burstCount)) ? Number(raw.burstCount) : defaults.burstCount,
   burstInterval: BURST_INTERVALS.includes(Number(raw.burstInterval)) ? Number(raw.burstInterval) : defaults.burstInterval,
  };
 } catch {
  return defaults;
 }
}

function saveCameraSettings() {
 try {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
 } catch {
  // Settings are optional; a blocked storage must not stop the camera.
 }
}

function applyCameraSettings() {
 const stage = byId('shoot-stage');
 const aspect = state.settings.aspect;
 stage.style.aspectRatio = aspect === 'source' ? '3 / 4' : aspect.replace(':', ' / ');
 byId('shoot-video').style.objectFit = aspect === 'source' ? 'contain' : 'cover';
 for (const button of byId('shoot-aspects').querySelectorAll('button')) {
  button.setAttribute('aria-pressed', String(button.dataset.aspect === aspect));
 }
 byId('shoot-quality').value = String(state.settings.quality);
 byId('shoot-mirror-save').checked = state.settings.mirrorSave;
 byId('shoot-ref-opacity').value = String(state.settings.refOpacity);
 byId('shoot-ref-scale').value = String(state.settings.refScale);
 byId('shoot-ref-lock').checked = state.settings.refLocked;
 byId('shoot-burst-count').value = String(state.settings.burstCount);
 byId('shoot-burst-interval').value = String(state.settings.burstInterval);
 updateBurstButton();
}

function closeSettings() {
 const panel = byId('shoot-settings');
 if (panel) panel.hidden = true;
}

function openSettings() {
 if (state.capturing) return;
 const panel = byId('shoot-settings');
 panel.hidden = false;
 closePicker();
 state.refDragging = false;
 state.drag = null;
 applyCameraSettings();
 applyRef();
 byId('shoot-settings-close').focus({ preventScroll: true });
 panel.scrollIntoView({ block: 'start' });
}

function isWeChat() {
  return /MicroMessenger/i.test(navigator.userAgent);
}

function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function usesLongPress() {
  return isWeChat() || isMobile();
}

function readDataUrl(blob, onReader) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    onReader?.(reader);
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    reader.readAsDataURL(blob);
  });
}

function formatBytes(size) {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function closePicker() {
  const panel = byId('shoot-picker');
  if (panel) panel.hidden = true;
}

function refTransform() {
  const x = (state.settings.refX * 100).toFixed(2);
  const y = (state.settings.refY * 100).toFixed(2);
  return `translate(${x}%, ${y}%) scale(${state.settings.refScale})`;
}

function applyRef() {
  const comparing = state.phase === 'review' && state.compare && state.hasRef;
  const showing = state.hasRef && (state.phase === 'review' ? comparing : state.refMode !== 'off');
  const stage = byId('shoot-stage');
  stage.dataset.ref = state.refMode;
  stage.dataset.compare = String(comparing);
  stage.dataset.refDrag = String(state.refDragging && state.phase === 'live');
  const ref = byId('shoot-ref');
  const movable = showing && (comparing || state.refMode === 'overlay');
  ref.hidden = !showing;
  ref.style.opacity = showing ? String(comparing ? Math.min(0.8, state.settings.refOpacity) : state.settings.refOpacity) : '';
  ref.style.transform = movable ? refTransform() : '';
  ref.tabIndex = state.refDragging ? 0 : -1;
  if (state.refDragging) ref.setAttribute('aria-label', '参考图，拖动或方向键调整位置，按 Esc 完成');
  else ref.removeAttribute('aria-label');
  byId('shoot-ref-toggle').hidden = !(state.hasRef && state.phase === 'live');
  byId('shoot-ref-toggle').textContent = REF_LABELS[state.refMode];
  byId('shoot-ref-toggle').setAttribute('aria-label', REF_HINTS[state.refMode]);
  byId('shoot-ref-toggle').disabled = state.phase !== 'live' || state.capturing;
  const move = byId('shoot-ref-move');
  const canMove = state.hasRef && state.phase === 'live' && state.refMode === 'overlay' && !state.settings.refLocked && !state.capturing;
  move.hidden = !canMove;
  move.textContent = state.refDragging ? '完成移动' : '移动参考';
  move.setAttribute('aria-pressed', String(state.refDragging));
  move.setAttribute('aria-label', state.refDragging ? '完成移动参考图' : '移动参考图位置');
  byId('shoot-compare').hidden = !(state.phase === 'review' && state.hasRef);
  byId('shoot-compare').textContent = state.compare ? '隐藏参考' : '对比参考';
}

function setPhase(phase) {
  state.phase = phase;
  if (phase !== 'live') {
    closePicker();
    closeSettings();
    cancelCountdown();
    state.refDragging = false;
    state.drag = null;
  }
  const review = phase === 'review';
  const canRetry = phase === 'error' && !['unsupported', 'insecure'].includes(state.errorKey);
  byId('shoot-dialog').dataset.phase = phase;
  byId('shoot-video').hidden = review;
  byId('shoot-result').hidden = !review;
  byId('shoot-cue').hidden = review;
  byId('shoot-live-controls').hidden = review;
  byId('shoot-review-controls').hidden = !review;
  byId('shoot-fallback').hidden = review;
  byId('shoot-photo-meta').hidden = !review;
  byId('shoot-save-hint').hidden = !review;
  byId('shoot-share').hidden = review && isWeChat();
  byId('shoot-save').textContent = usesLongPress() ? '长按照片保存' : '保存到相册';
  byId('shoot-save').disabled = false;
  if (review) {
    byId('shoot-save-hint').textContent = isWeChat()
      ? '微信里请长按上方照片，选择“保存图片”或“发送给朋友”。'
      : usesLongPress()
        ? '请长按上方照片，选择“添加到照片/存储图像”；分享按钮会打开系统分享面板。'
        : '保存按钮会下载照片；分享按钮会打开系统分享面板（需要浏览器支持）。';
  }
  byId('shoot-shutter').disabled = phase !== 'live' || state.capturing;
  byId('shoot-flip').disabled = phase !== 'live' || state.capturing;
  byId('shoot-burst').disabled = phase !== 'live' || state.capturing;
  byId('shoot-timer').disabled = phase !== 'live' || state.capturing;
  for (const id of ['shoot-settings-open', 'shoot-ref-library', 'shoot-native']) {
    byId(id).disabled = phase === 'live' && state.capturing;
  }
  byId('shoot-retry').hidden = !canRetry;
  if (phase === 'error') {
    const target = byId(canRetry ? 'shoot-retry' : 'shoot-close');
    if (document.activeElement !== target) target.focus();
  }
  applyGrid();
  if (phase === 'starting') keepFocusInside('shoot-close');
  if (phase === 'live') keepFocusInside(state.capturing ? 'shoot-close' : 'shoot-shutter');
  applyRef();
}

function keepFocusInside(fallbackId) {
  const active = document.activeElement;
  if (!active || active === document.body || active.closest('[hidden]') || active.disabled) byId(fallbackId).focus();
}

function updateTimerButton() {
  const button = byId('shoot-timer');
  const counting = state.countdown != null;
  button.textContent = counting ? '取消' : state.delay ? `${state.delay}s` : '定时';
  button.setAttribute('aria-label', counting
    ? '取消自拍定时'
    : state.delay ? `自拍定时 ${state.delay} 秒，点击更换` : '自拍定时：关闭，点击开启');
}

function cancelCountdown() {
  if (state.countdownTimer !== null) clearTimeout(state.countdownTimer);
  state.countdownTimer = null;
  state.countdown = null;
  const box = byId('shoot-countdown');
  box.hidden = true;
  box.textContent = '';
  updateTimerButton();
  byId('shoot-shutter').disabled = state.phase !== 'live' || state.capturing;
}

function tickCountdown() {
  if (state.countdown == null) return;
  byId('shoot-countdown').textContent = state.countdown > 0 ? String(state.countdown) : '拍';
  if (state.countdown <= 0) {
    state.countdownTimer = setTimeout(() => {
      const token = state.countdownStart;
      cancelCountdown();
      if (state.phase === 'live' && token === state.token) takePhotos();
    }, 250);
    return;
  }
  state.countdown -= 1;
  state.countdownTimer = setTimeout(tickCountdown, 1000);
}

function startCountdown(seconds) {
  cancelCountdown();
  state.countdown = seconds;
  state.countdownStart = state.token;
  byId('shoot-countdown').hidden = false;
  byId('shoot-shutter').disabled = true;
  updateTimerButton();
  showNotice(`开始倒数 ${seconds} 秒，点“取消”可以停止。`);
  byId('shoot-timer').focus();
  tickCountdown();
}

function cycleTimer() {
  if (state.countdown != null) {
    cancelCountdown();
    showNotice('已取消定时。');
    return;
  }
  state.delay = TIMERS[(TIMERS.indexOf(state.delay) + 1) % TIMERS.length];
  updateTimerButton();
  showNotice(state.delay ? `自拍定时 ${state.delay} 秒。按快门后开始倒数。` : '自拍定时已关闭。');
}

function applyGrid() {
  const button = byId('shoot-grid-toggle');
  const shown = state.gridOn && state.phase === 'live';
  byId('shoot-grid').hidden = !shown;
  button.setAttribute('aria-pressed', String(state.gridOn));
  button.setAttribute('aria-label', state.gridOn ? '隐藏九宫格' : '显示九宫格');
}

function toggleGrid() {
  state.gridOn = !state.gridOn;
  applyGrid();
}

function updateBurstButton() {
  const button = byId('shoot-burst');
  const count = state.settings.burstCount;
  button.textContent = count > 1 ? `连拍 ${count}` : '连拍';
  button.setAttribute('aria-pressed', String(count > 1));
  button.setAttribute('aria-label', count > 1 ? `连拍 ${count} 张，点击更换` : '连拍：关闭，点击开启');
}

function cycleBurst() {
  if (state.phase !== 'live' || state.capturing) return;
  const index = BURST_COUNTS.indexOf(state.settings.burstCount);
  state.settings.burstCount = BURST_COUNTS[(index + 1) % BURST_COUNTS.length];
  saveCameraSettings();
  applyCameraSettings();
  showNotice(state.settings.burstCount > 1
    ? `连拍 ${state.settings.burstCount} 张，间隔 ${state.settings.burstInterval / 1000} 秒。按快门开始。`
    : '连拍已关闭。');
}

function onShutter() {
  if (state.phase !== 'live' || state.capturing || state.countdown != null) return;
  if (state.delay) startCountdown(state.delay);
  else takePhotos();
}

function fail(key) {
  recordEvent('camera-error', key);
  state.errorKey = key;
  state.capturing = false;
  setPhase('error');
  showNotice(MESSAGES[key]);
}

function messageKey(error) {
  const name = error?.name;
  if (['NotAllowedError', 'SecurityError', 'PermissionDeniedError'].includes(name)) return 'denied';
  if (['NotFoundError', 'OverconstrainedError', 'DevicesNotFoundError'].includes(name)) return 'missing';
  if (['NotReadableError', 'AbortError', 'TrackStartError'].includes(name)) return 'busy';
  return 'other';
}

function stopStream() {
  const video = byId('shoot-video');
  byId('shoot-torch-row').hidden = true;
  byId('shoot-zoom-row').hidden = true;
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  video.srcObject = null;
}

function cancelBurst() {
  if (state.burstTimer !== null) clearTimeout(state.burstTimer);
  state.burstTimer = null;
  if (state.burstResolve) {
    const resolve = state.burstResolve;
    state.burstResolve = null;
    resolve();
  }
}

function waitForBurstGap(ms) {
  return new Promise((resolve) => {
    state.burstResolve = resolve;
    state.burstTimer = setTimeout(() => {
      state.burstTimer = null;
      state.burstResolve = null;
      resolve();
    }, ms);
  });
}

function clearPhoto() {
  state.dataReader?.abort();
  state.dataReader = null;
  byId('shoot-save').disabled = false;
  const urls = new Set(state.shots.map((shot) => shot.url));
  for (const url of urls) URL.revokeObjectURL(url);
  if (state.url && !urls.has(state.url)) URL.revokeObjectURL(state.url);
  state.shots = [];
  state.selected = 0;
  state.reviewToken += 1;
  state.url = '';
  state.blob = null;
  state.name = '';
  state.capturing = false;
  byId('shoot-result').removeAttribute('src');
  byId('shoot-shots').replaceChildren();
  byId('shoot-shots').hidden = true;
  byId('shoot-photo-meta').textContent = '';
  byId('shoot-photo-meta').hidden = true;
}

async function startCamera() {
  const token = ++state.token;
  stopStream();
  state.errorKey = '';
  state.capturing = false;
  setPhase('starting');
  showNotice('正在打开相机…');
  if (!window.isSecureContext) {
    fail('insecure');
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    fail('unsupported');
    return;
  }
  const video = byId('shoot-video');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: state.facing }, width: { ideal: 2560 }, height: { ideal: 1440 } },
      audio: false,
    });
  } catch (error) {
    if (token !== state.token) return;
    console.error('Unable to start the camera', error);
    stopStream();
    fail(messageKey(error));
    return;
  }
  if (token !== state.token || !byId('shoot-dialog').open) {
    stream.getTracks().forEach((track) => track.stop());
    return;
  }
  state.stream = stream;
  const track = stream.getVideoTracks()[0];
  recordEvent('camera-start', `facing=${state.facing}`);
  setupTorch(track);
  setupZoom(track);
  const actual = track?.getSettings?.().facingMode;
  if (actual === 'user' || actual === 'environment') state.facing = actual;
  track?.addEventListener('ended', () => {
    if (token === state.token && state.phase === 'live') fail('lost');
  });
  video.srcObject = stream;
  try {
    await video.play();
  } catch (error) {
    if (token !== state.token) return;
    console.error('Unable to play the camera stream', error);
    stopStream();
    fail(['NotAllowedError', 'NotReadableError', 'AbortError'].includes(error?.name) ? 'play' : messageKey(error));
    return;
  }
  if (token !== state.token) return;
  byId('shoot-stage').dataset.facing = state.facing;
  setPhase('live');
  recordEvent('camera-live', `facing=${state.facing}`);
  showNotice(state.facing === 'user' ? FRONT_NOTE : '');
}

function setupTorch(track) {
 const row = byId('shoot-torch-row');
 const box = byId('shoot-torch');
 const capabilities = track?.getCapabilities?.() ?? {};
 recordEvent('camera-torch', capabilities.torch === true ? 'available' : 'unavailable');
 row.hidden = capabilities.torch !== true;
 box.checked = false;
 box.onchange = async () => {
  try {
   await track.applyConstraints({ advanced: [{ torch: box.checked }] });
  } catch (error) {
   box.checked = false;
   showNotice('当前浏览器不能控制手电。');
  }
 };
}

function setupZoom(track) {
 const row = byId('shoot-zoom-row');
 const input = byId('shoot-zoom');
 const capabilities = track?.getCapabilities?.() ?? {};
 recordEvent('camera-zoom', capabilities.zoom ? `available ${capabilities.zoom.min}-${capabilities.zoom.max}` : 'unavailable');
 if (!capabilities.zoom) {
  row.hidden = true;
  return;
 }
 const { min, max, step } = capabilities.zoom;
 row.hidden = false;
 input.min = String(min);
 input.max = String(max);
 input.step = String(step || 0.1);
 input.value = String(track.getSettings?.().zoom ?? min);
 input.oninput = async () => {
  try {
   await track.applyConstraints({ advanced: [{ zoom: Number(input.value) }] });
  } catch (error) {
   console.warn('Unable to apply zoom', error);
  }
 };
}

function cropFor(width, height, aspect) {
 if (aspect === 'source') return { sx: 0, sy: 0, sw: width, sh: height };
 const [aw, ah] = aspect.split(':').map(Number);
 const target = aw / ah;
 if (width / height > target) {
  const sw = Math.round(height * target);
  return { sx: Math.round((width - sw) / 2), sy: 0, sw, sh: height };
 }
 const sh = Math.round(width / target);
 return { sx: 0, sy: Math.round((height - sh) / 2), sw: width, sh };
}

function mirrorFront() {
 return state.facing === 'user' && state.settings.mirrorSave;
}

async function processCaptured(blob) {
 if (state.settings.aspect === 'source' && !mirrorFront() && state.settings.quality === 0.92) return blob;
 try {
  const bitmap = await createImageBitmap(blob);
  const crop = cropFor(bitmap.width, bitmap.height, state.settings.aspect);
  const canvas = document.createElement('canvas');
  canvas.width = crop.sw;
  canvas.height = crop.sh;
  const context = canvas.getContext('2d');
  if (mirrorFront()) {
   context.translate(crop.sw, 0);
   context.scale(-1, 1);
  }
  context.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.sw, crop.sh);
  bitmap.close();
  const result = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', state.settings.quality));
  return result ?? blob;
 } catch (error) {
  console.warn('Unable to apply the camera settings to the still photo', error);
  return blob;
 }
}

async function captureStill() {
  const video = byId('shoot-video');
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (state.phase !== 'live' || !state.capturing || !width || !height) return null;
  const token = state.token;
  const track = state.stream?.getVideoTracks()[0];
  const settings = track?.getSettings?.() ?? {};
  if (track && 'ImageCapture' in window && (settings.width ?? 0) >= 1280) {
    try {
      const blob = await processCaptured(await new ImageCapture(track).takePhoto());
      if (token !== state.token || state.phase !== 'live' || !state.capturing) return null;
      return blob;
    } catch (error) {
      console.warn('ImageCapture failed, falling back to the canvas', error);
    }
  }
  const crop = cropFor(width, height, state.settings.aspect);
  const canvas = document.createElement('canvas');
  canvas.width = crop.sw;
  canvas.height = crop.sh;
  const context = canvas.getContext('2d');
  if (mirrorFront()) {
   context.translate(crop.sw, 0);
   context.scale(-1, 1);
  }
  context.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.sw, crop.sh);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (token !== state.token || state.phase !== 'live' || !state.capturing) {
        resolve(null);
        return;
      }
      resolve(blob);
    }, 'image/jpeg', state.settings.quality);
  });
}

async function takePhotos() {
  const video = byId('shoot-video');
  if (state.phase !== 'live' || state.capturing || !video.videoWidth || !video.videoHeight) {
    showNotice('相机还没准备好，请稍等一下。');
    return;
  }
  const token = state.token;
  const count = state.settings.burstCount;
  closeSettings();
  closePicker();
  state.capturing = true;
  setPhase('live');
  showNotice(count > 1 ? `连拍 1/${count}…` : '正在生成照片…');
  const shots = [];
  let lastStart = 0;
  for (let index = 0; index < count; index += 1) {
    if (token !== state.token || state.phase !== 'live' || !state.capturing) return;
    if (index > 0) {
      const remaining = Math.max(0, state.settings.burstInterval - (performance.now() - lastStart));
      if (remaining > 0) await waitForBurstGap(remaining);
      if (token !== state.token || state.phase !== 'live' || !state.capturing) return;
      showNotice(`连拍 ${index + 1}/${count}…`);
    }
    lastStart = performance.now();
    const blob = await captureStill();
    if (token !== state.token || state.phase !== 'live' || !state.capturing) return;
    if (!blob) {
      state.capturing = false;
      if (shots.length) {
        recordEvent('burst-partial', `failed=${index + 1} kept=${shots.length}`);
        showReview(shots, '', `第 ${index + 1} 张失败，已保留前 ${shots.length} 张。点缩略图选一张保存或分享。`);
      } else {
        recordEvent('burst-failed', `count=${count}`);
        setPhase('live');
        showNotice('拍照失败，请重试。');
      }
      return;
    }
    shots.push(blob);
  }
  state.capturing = false;
  if (!shots.length) {
    recordEvent('burst-failed', `count=${count}`);
    setPhase('live');
    showNotice('拍照失败，请重试。');
    return;
  }
  recordEvent('photos', `${shots.length}/${count} aspect=${state.settings.aspect} quality=${state.settings.quality}`);
  showReview(shots);
}

function renderShots() {
  const strip = byId('shoot-shots');
  const many = state.phase === 'review' && state.shots.length > 1;
  const hadFocus = strip.contains(document.activeElement);
  strip.hidden = !many;
  strip.replaceChildren();
  if (!many) return;
  state.shots.forEach((shot, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'shoot-shot';
    button.dataset.index = String(index);
    button.setAttribute('aria-pressed', String(index === state.selected));
    button.setAttribute('aria-label', `第 ${index + 1} 张，共 ${state.shots.length} 张`);
    const image = document.createElement('img');
    image.src = shot.url;
    image.alt = '';
    const badge = document.createElement('span');
    badge.textContent = String(index + 1);
    button.append(image, badge);
    button.addEventListener('click', () => selectShot(index));
    strip.append(button);
  });
  if (hadFocus) strip.querySelector(`[data-index="${state.selected}"]`)?.focus();
}

async function selectShot(index) {
  const shot = state.shots[index];
  if (!shot || state.phase !== 'review') return;
  state.selected = index;
  state.blob = shot.blob;
  state.url = shot.url;
  const token = ++state.reviewToken;
  const image = byId('shoot-result');
  const save = byId('shoot-save');
  const needsData = usesLongPress();
  image.dataset.shot = String(index);
  image.alt = state.shots.length > 1
    ? `第 ${index + 1} 张，共 ${state.shots.length} 张照片，尚未保存`
    : '刚拍的照片，尚未保存';
  byId('shoot-photo-meta').hidden = false;
  byId('shoot-photo-meta').textContent = `${formatBytes(shot.blob.size)} · 读取尺寸…`;
  image.src = shot.url;
  renderShots();
  if (!needsData) {
    state.dataReader?.abort();
    save.disabled = false;
    return;
  }
  state.dataReader?.abort();
  save.disabled = true;
  let reader = null;
  try {
    const src = await readDataUrl(shot.blob, (created) => {
      reader = created;
      state.dataReader = created;
    });
    if (token === state.reviewToken && state.phase === 'review') {
      image.src = src;
      save.disabled = false;
    }
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.warn('Unable to prepare the photo for long-press saving', error);
      if (token === state.reviewToken && state.phase === 'review') {
        save.disabled = false;
        showNotice('长按保存准备失败，请重试拍摄，或使用分享。');
      }
    }
  } finally {
    if (state.dataReader === reader) state.dataReader = null;
  }
}

async function showReview(input, name = '', warning = '') {
  const shots = (Array.isArray(input) ? input : [input]).filter(Boolean);
  if (!shots.length) return;
  state.token += 1;
  cancelBurst();
  stopStream();
  clearPhoto();
  state.name = name;
  state.compare = false;
  state.shots = shots.map((blob) => {
    const typed = blob.type ? blob : blob.slice(0, blob.size, typeFor(name, blob.type));
    return { blob: typed, url: URL.createObjectURL(typed) };
  });
  state.selected = 0;
  setPhase('review');
  recordEvent('review', `${shots.length} shot(s)`);
  renderShots();
  showNotice(warning || (shots.length > 1
    ? `拍了 ${shots.length} 张，点下面的缩略图选一张保存或分享。`
    : name ? `已选择 ${name}，确认后保存或分享。` : '拍好了。可以重拍，或保存、分享。'));
  byId('shoot-dialog').scrollTop = 0;
  byId('shoot-close').focus({ preventScroll: true });
  await selectShot(0);
  const save = byId('shoot-save');
  (save.disabled ? byId('shoot-close') : save).focus({ preventScroll: true });
}

function fileName(type, index = 0) {
  const now = new Date();
  const two = (value) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return `pose-${stamp}${index ? `-${index}` : ''}.${EXTENSIONS[type] ?? 'jpg'}`;
}

function download(file) {
  if (!state.blob || !state.url) return;
  const link = document.createElement('a');
  link.href = state.url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  showNotice(SAVE_NOTE);
}

function photoFile() {
  const name = state.name || fileName(state.blob.type, state.shots.length > 1 ? state.selected + 1 : 0);
  const type = typeFor(name, state.blob.type);
  return new File([state.blob], name, { type });
}

function savePhoto() {
  if (!state.blob) return;
  if (usesLongPress()) {
    recordEvent('save', 'long-press');
    showNotice('保存：长按上方照片，选择“保存图片/存储图像”，也可以发送给朋友。');
    byId('shoot-result').scrollIntoView({ block: 'center' });
    return;
  }
  if (!state.url) return;
  recordEvent('save', 'download');
  download(photoFile());
}

async function sharePhoto() {
  if (!state.blob) return;
  const file = photoFile();
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: state.pose?.name ?? '照片' });
      recordEvent('share', 'sheet');
      showNotice('已交给系统分享面板。');
      return;
    } catch (error) {
      if (error?.name === 'AbortError') {
        recordEvent('share', 'cancelled');
        return;
      }
      console.warn('Sharing failed', error);
    }
  }
  recordEvent('share', 'fallback');
  showNotice('当前浏览器不支持直接分享文件，请长按照片保存。');
  byId('shoot-result').scrollIntoView({ block: 'center' });
}

function retake() {
  clearPhoto();
  startCamera();
}

function flipCamera() {
  if (state.capturing) return;
  state.facing = state.facing === 'user' ? 'environment' : 'user';
  startCamera();
}

function cycleReference() {
  state.refMode = REF_MODES[(REF_MODES.indexOf(state.refMode) + 1) % REF_MODES.length];
  if (state.refMode !== 'overlay') state.refDragging = false;
  applyRef();
}

function setRefDragging(on) {
  if (on) {
    if (!state.hasRef || state.phase !== 'live' || state.settings.refLocked) return;
    if (state.refMode !== 'overlay') state.refMode = 'overlay';
    state.refDragging = true;
    applyRef();
    byId('shoot-ref').focus({ preventScroll: true });
    showNotice('拖动参考图对齐人物；方向键可微调，按 Esc 完成。');
    return;
  }
  state.refDragging = false;
  state.drag = null;
  saveCameraSettings();
  applyRef();
  const move = byId('shoot-ref-move');
  if (!move.hidden) move.focus({ preventScroll: true });
  showNotice('参考图位置已保存。');
}

function startRefDrag(event) {
  if (!state.refDragging || event.button !== 0) return;
  const rect = byId('shoot-stage').getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  event.preventDefault();
  byId('shoot-ref').setPointerCapture?.(event.pointerId);
  state.drag = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    baseX: state.settings.refX,
    baseY: state.settings.refY,
    width: rect.width,
    height: rect.height,
  };
}

function moveRefDrag(event) {
  const drag = state.drag;
  if (!drag || drag.id !== event.pointerId) return;
  event.preventDefault();
  state.settings.refX = clampOffset(drag.baseX + (event.clientX - drag.x) / drag.width);
  state.settings.refY = clampOffset(drag.baseY + (event.clientY - drag.y) / drag.height);
  applyRef();
}

function endRefDrag(event) {
  const drag = state.drag;
  if (!drag || drag.id !== event.pointerId) return;
  state.drag = null;
  saveCameraSettings();
  showNotice('参考图位置已保存；点“完成移动”可继续拍摄。');
}

function nudgeRef(event) {
  if (!state.refDragging) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    setRefDragging(false);
    return;
  }
  const step = event.shiftKey ? 0.06 : 0.02;
  const deltas = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  const delta = deltas[event.key];
  if (!delta) return;
  event.preventDefault();
  state.settings.refX = clampOffset(state.settings.refX + delta[0]);
  state.settings.refY = clampOffset(state.settings.refY + delta[1]);
  saveCameraSettings();
  applyRef();
}

function useSystemPhoto(event) {
  const input = event.target;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/') && !(file.type === '' && IMAGE_NAME.test(file.name))) {
    showNotice('选的文件不是图片，请重新选择。');
    return;
  }
  recordEvent('system-photo', file.type || 'unknown');
  showReview(file, file.name);
}

function galleryEntries(data) {
  const entries = [];
  for (const group of data.groups) {
    if (!Object.hasOwn(POSTURE_LABELS, group.posture)) continue;
    for (const [angle, path] of Object.entries(group.views || {})) {
      if (!Object.hasOwn(ANGLE_LABELS, angle) || typeof path !== 'string' || !GALLERY_IMAGE_PATH.test(path)) continue;
      entries.push({ id: group.id, posture: group.posture, angle, path });
    }
  }
  const postures = Object.keys(POSTURE_LABELS);
  const angles = Object.keys(ANGLE_LABELS);
  return entries.sort((a, b) => postures.indexOf(a.posture) - postures.indexOf(b.posture)
    || a.id.localeCompare(b.id) || angles.indexOf(a.angle) - angles.indexOf(b.angle));
}

async function loadPicker() {
  const request = ++picker.request;
  byId('shoot-picker-retry').hidden = true;
  byId('shoot-picker-status').textContent = '正在读取图库…';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(GALLERY_DATA_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (request !== picker.request) return;
    if (data?.version !== 1 || !Array.isArray(data.groups)) throw new TypeError('Invalid gallery catalog');
    picker.entries = galleryEntries(data);
    picker.loaded = true;
    picker.limit = PICKER_PAGE;
    renderPicker();
  } catch (error) {
    if (request !== picker.request) return;
    console.error('Unable to load the reference library', error);
    byId('shoot-picker-status').textContent = error.name === 'AbortError'
      ? '读取图库超时。检查连接后重试。'
      : '图库读取失败。检查连接后重试，或直接拍摄。';
    byId('shoot-picker-retry').hidden = false;
  } finally {
    clearTimeout(timer);
  }
}

function renderPicker() {
  const posture = byId('shoot-picker-posture').value;
  const entries = picker.entries.filter((entry) => posture === 'all' || entry.posture === posture);
  const shown = entries.slice(0, picker.limit);
  const grid = byId('shoot-picker-grid');
  grid.replaceChildren();
  for (const entry of shown) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'shoot-picker-card';
    card.setAttribute('aria-label', `用这张${POSTURE_LABELS[entry.posture]}${ANGLE_LABELS[entry.angle]}线稿作参考`);
    const image = document.createElement('img');
    image.loading = 'lazy';
    image.decoding = 'async';
    image.src = GALLERY_IMAGE_ROOT + entry.path;
    image.alt = '';
    const caption = document.createElement('span');
    caption.textContent = `${POSTURE_LABELS[entry.posture]} · ${ANGLE_LABELS[entry.angle]}`;
    card.append(image, caption);
    card.addEventListener('click', () => chooseReference(entry));
    grid.append(card);
  }
  byId('shoot-picker-status').textContent = picker.entries.length
    ? `${entries.length} 张线稿 · 显示 ${shown.length} 张`
    : '图库里没有可用的线稿。';
  byId('shoot-picker-more').hidden = picker.limit >= entries.length;
  if (picker.scrollNeeded) {
    picker.scrollNeeded = false;
    byId('shoot-picker').scrollIntoView({ block: 'start' });
  }
}

function chooseReference(entry) {
  state.hasRef = true;
  state.refMode = 'overlay';
  state.refDragging = false;
  const ref = byId('shoot-ref');
  ref.src = GALLERY_IMAGE_ROOT + entry.path;
  ref.alt = `${POSTURE_LABELS[entry.posture]}${ANGLE_LABELS[entry.angle]}的人偶线稿姿势参考`;
  applyRef();
  closePicker();
  showNotice(`已选参考图：${POSTURE_LABELS[entry.posture]} · ${ANGLE_LABELS[entry.angle]}。可以切换角落、叠加或隐藏；叠加时点“移动参考”可拖动。`);
  byId('shoot-ref-library').focus();
}

function openPicker() {
  if (state.capturing) return;
  closeSettings();
  state.refDragging = false;
  state.drag = null;
  applyRef();
  const panel = byId('shoot-picker');
  panel.hidden = false;
  picker.scrollNeeded = true;
  if (picker.loaded) renderPicker();
  else loadPicker();
  byId('shoot-picker-close').focus({ preventScroll: true });
}

function fillGuide(pose) {
  byId('shoot-title').textContent = pose.name;
  byId('shoot-cue').textContent = `“${pose.cue}”`;
  byId('shoot-check').textContent = `检查：${pose.quickCheck}`;
  byId('shoot-camera-tip').textContent = pose.camera;
  const steps = byId('shoot-steps');
  steps.replaceChildren();
  for (const step of pose.steps) {
    const item = document.createElement('li');
    item.textContent = step;
    steps.append(item);
  }
  const referenceSrc = pose.previewImage ?? pose.diagram;
  state.hasRef = Boolean(referenceSrc);
  const ref = byId('shoot-ref');
  if (state.hasRef) {
    ref.src = referenceSrc;
    ref.alt = pose.previewImage ? `${pose.name}的人偶线稿姿势参考` : `${pose.name}的站位示意图`;
  } else {
    ref.removeAttribute('src');
  }
}

function cleanup() {
  closePicker();
  cancelBurst();
  state.token += 1;
  state.capturing = false;
  stopStream();
  clearPhoto();
  state.phase = 'idle';
  byId('shoot-dialog').dataset.phase = 'idle';
  cancelCountdown();
  const opener = state.opener;
  state.pose = null;
  state.opener = null;
  if (opener?.isConnected) opener.focus();
}

function suspend() {
  const dialog = byId('shoot-dialog');
  if (!dialog.open) return;
  if (!['live', 'starting'].includes(state.phase)) return;
  state.token += 1;
  state.capturing = false;
  cancelBurst();
  state.refDragging = false;
  stopStream();
  setPhase('paused');
  showNotice('相机已暂停，回到页面后会自动继续。');
}

function resume() {
  if (!byId('shoot-dialog').open || document.visibilityState === 'hidden') return;
  if (state.phase === 'paused') startCamera();
}

function pauseWhenHidden() {
  if (document.visibilityState === 'hidden') suspend();
  else resume();
}

function wire() {
  if (wired) return;
  wired = true;
  const dialog = byId('shoot-dialog');
  byId('shoot-close').addEventListener('click', () => {
    stopStream();
    dialog.close();
  });
  dialog.addEventListener('cancel', stopStream);
  dialog.addEventListener('close', cleanup);
  byId('shoot-shutter').addEventListener('click', onShutter);
  byId('shoot-timer').addEventListener('click', cycleTimer);
  byId('shoot-burst').addEventListener('click', cycleBurst);
  byId('shoot-grid-toggle').addEventListener('click', toggleGrid);
  byId('shoot-flip').addEventListener('click', flipCamera);
  byId('shoot-retry').addEventListener('click', startCamera);
  byId('shoot-retake').addEventListener('click', retake);
  byId('shoot-save').addEventListener('click', savePhoto);
  byId('shoot-share').addEventListener('click', sharePhoto);
  byId('shoot-compare').addEventListener('click', () => {
    state.compare = !state.compare;
    applyRef();
  });
  byId('shoot-ref-toggle').addEventListener('click', cycleReference);
  byId('shoot-ref-move').addEventListener('click', () => setRefDragging(!state.refDragging));
  byId('shoot-ref').addEventListener('pointerdown', startRefDrag);
  byId('shoot-ref').addEventListener('pointermove', moveRefDrag);
  byId('shoot-ref').addEventListener('pointerup', endRefDrag);
  byId('shoot-ref').addEventListener('pointercancel', endRefDrag);
  byId('shoot-ref').addEventListener('keydown', nudgeRef);
  byId('shoot-native').addEventListener('click', () => byId('shoot-file').click());
  byId('shoot-file').addEventListener('change', useSystemPhoto);
  byId('shoot-ref').addEventListener('error', () => {
    recordEvent('ref-error', 'image failed');
    const hadFocus = document.activeElement === byId('shoot-ref');
    state.hasRef = false;
    state.refDragging = false;
    state.drag = null;
    applyRef();
    if (hadFocus) byId('shoot-ref-library').focus();
  });
  byId('shoot-result').addEventListener('load', () => {
    if (state.phase !== 'review' || !state.blob) return;
    const image = byId('shoot-result');
    if (image.dataset.shot !== String(state.selected)) return;
    byId('shoot-photo-meta').hidden = false;
    byId('shoot-photo-meta').textContent = `${image.naturalWidth} × ${image.naturalHeight} · ${formatBytes(state.blob.size)}`;
  });
  byId('shoot-result').addEventListener('error', () => {
    if (state.phase === 'review') showNotice('这张照片在当前浏览器里无法预览，但文件没有被改动，仍然可以保存或分享。');
  });
  byId('shoot-settings-open').addEventListener('click', () => {
    if (byId('shoot-settings').hidden) openSettings();
    else closeSettings();
  });
  byId('shoot-settings-close').addEventListener('click', () => {
    closeSettings();
    byId('shoot-settings-open').focus();
  });
  byId('shoot-aspects').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-aspect]');
    if (!button) return;
    state.settings.aspect = button.dataset.aspect;
    saveCameraSettings();
    applyCameraSettings();
  });
  byId('shoot-quality').addEventListener('change', (event) => {
    state.settings.quality = Number(event.target.value);
    saveCameraSettings();
  });
  byId('shoot-burst-count').addEventListener('change', (event) => {
    state.settings.burstCount = Number(event.target.value);
    saveCameraSettings();
    updateBurstButton();
    showNotice(state.settings.burstCount > 1
      ? `连拍 ${state.settings.burstCount} 张，间隔 ${state.settings.burstInterval / 1000} 秒。`
      : '连拍已关闭。');
  });
  byId('shoot-burst-interval').addEventListener('change', (event) => {
    state.settings.burstInterval = Number(event.target.value);
    saveCameraSettings();
    showNotice(`连拍间隔 ${state.settings.burstInterval / 1000} 秒。`);
  });
  byId('shoot-mirror-save').addEventListener('change', (event) => {
    state.settings.mirrorSave = event.target.checked;
    saveCameraSettings();
  });
  byId('shoot-ref-opacity').addEventListener('input', (event) => {
    state.settings.refOpacity = Number(event.target.value);
    saveCameraSettings();
    applyRef();
  });
  byId('shoot-ref-scale').addEventListener('input', (event) => {
    state.settings.refScale = Number(event.target.value);
    saveCameraSettings();
    applyRef();
  });
  byId('shoot-ref-lock').addEventListener('change', (event) => {
    state.settings.refLocked = event.target.checked;
    if (state.settings.refLocked) {
      state.refDragging = false;
      state.drag = null;
    }
    saveCameraSettings();
    applyRef();
    showNotice(event.target.checked ? '参考图位置已锁定。' : '参考图位置已解锁，可以拖动。');
  });
  byId('shoot-settings-reset').addEventListener('click', () => {
    state.settings = { aspect: 'source', quality: 0.92, mirrorSave: false, refOpacity: 0.45, refScale: 1, refX: 0, refY: 0, refLocked: false, burstCount: 1, burstInterval: 800 };
    state.refDragging = false;
    state.drag = null;
    saveCameraSettings();
    applyCameraSettings();
    applyRef();
    showNotice('相机设置已恢复默认。');
  });
  byId('shoot-ref-library').addEventListener('click', () => {
    if (byId('shoot-picker').hidden) openPicker();
    else closePicker();
  });
  byId('shoot-picker-close').addEventListener('click', () => {
    closePicker();
    byId('shoot-ref-library').focus();
  });
  byId('shoot-picker-retry').addEventListener('click', loadPicker);
  byId('shoot-picker-posture').addEventListener('change', () => {
    picker.limit = PICKER_PAGE;
    picker.scrollNeeded = true;
    renderPicker();
  });
  byId('shoot-picker-more').addEventListener('click', () => {
    picker.limit += PICKER_PAGE;
    renderPicker();
  });
  updateTimerButton();
  applyGrid();
  document.addEventListener('visibilitychange', pauseWhenHidden);
  window.addEventListener('pagehide', suspend);
  window.addEventListener('pageshow', resume);
}

export function openShoot(pose, opener) {
  wire();
  const dialog = byId('shoot-dialog');
  if (dialog.open) return;
  state.pose = pose;
  state.opener = opener;
  state.facing = 'environment';
  state.refMode = 'corner';
  state.capturing = false;
  state.refDragging = false;
  state.drag = null;
  cancelBurst();
  fillGuide(pose);
  byId('shoot-stage').dataset.facing = 'environment';
  byId('shoot-steps').closest('details').open = false;
  applyCameraSettings();
  dialog.showModal();
  if (document.visibilityState === 'hidden') {
    setPhase('paused');
    showNotice('相机已暂停，回到页面后会自动继续。');
    return;
  }
  startCamera();
}
