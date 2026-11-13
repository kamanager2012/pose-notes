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
const FRONT_NOTE = '前置镜头的预览是镜像的；保存是否镜像可在相机设置里改。';
const SAVE_NOTE = '已请求保存。请到浏览器的下载列表或相册里确认；没找到就用分享。';

const state = {
  pose: null, opener: null, stream: null, facing: 'environment', token: 0,
  phase: 'idle', errorKey: '', refMode: 'corner', hasRef: false, blob: null, url: '', name: '', capturing: false,
  delay: 0, countdown: null, countdownTimer: null, countdownStart: 0, gridOn: false,
  settings: readCameraSettings(), compare: false,
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

function readCameraSettings() {
 const defaults = { aspect: 'source', quality: 0.92, mirrorSave: false, refOpacity: 0.45, refScale: 1 };
 try {
  const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
  if (!raw || typeof raw !== 'object') return defaults;
  return {
   aspect: ASPECTS.has(raw.aspect) ? raw.aspect : defaults.aspect,
   quality: QUALITIES.includes(Number(raw.quality)) ? Number(raw.quality) : defaults.quality,
   mirrorSave: Boolean(raw.mirrorSave),
   refOpacity: Number(raw.refOpacity) >= 0.15 && Number(raw.refOpacity) <= 0.9 ? Number(raw.refOpacity) : defaults.refOpacity,
   refScale: Number(raw.refScale) >= 0.6 && Number(raw.refScale) <= 1.4 ? Number(raw.refScale) : defaults.refScale,
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
}

function closeSettings() {
 const panel = byId('shoot-settings');
 if (panel) panel.hidden = true;
}

function openSettings() {
 const panel = byId('shoot-settings');
 panel.hidden = false;
 closePicker();
 applyCameraSettings();
 byId('shoot-settings-close').focus({ preventScroll: true });
 panel.scrollIntoView({ block: 'start' });
}

function isWeChat() {
  return /MicroMessenger/i.test(navigator.userAgent);
}

function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function readDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
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

function applyRef() {
  const comparing = state.phase === 'review' && state.compare && state.hasRef;
  const showing = state.hasRef && (state.phase === 'review' ? comparing : state.refMode !== 'off');
  const stage = byId('shoot-stage');
  stage.dataset.ref = state.refMode;
  stage.dataset.compare = String(comparing);
  const ref = byId('shoot-ref');
  ref.hidden = !showing;
  ref.style.opacity = showing ? String(comparing ? Math.min(0.8, state.settings.refOpacity) : state.settings.refOpacity) : '';
  ref.style.transform = showing && !comparing && state.refMode === 'overlay' ? `scale(${state.settings.refScale})` : '';
  byId('shoot-ref-toggle').hidden = !(state.hasRef && state.phase === 'live');
  byId('shoot-ref-toggle').textContent = REF_LABELS[state.refMode];
  byId('shoot-ref-toggle').setAttribute('aria-label', REF_HINTS[state.refMode]);
  byId('shoot-ref-toggle').disabled = state.phase !== 'live';
  byId('shoot-compare').hidden = !(state.phase === 'review' && state.hasRef);
  byId('shoot-compare').textContent = state.compare ? '隐藏参考' : '对比参考';
}

function setPhase(phase) {
  state.phase = phase;
  if (phase !== 'live') {
    closePicker();
    closeSettings();
    cancelCountdown();
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
  byId('shoot-save').textContent = isWeChat() ? '长按照片保存' : '保存到相册';
  if (review) {
    byId('shoot-save-hint').textContent = isWeChat()
      ? '微信里请长按上方照片，选择“保存图片”或“发送给朋友”。'
      : '长按照片可保存到相册；分享按钮会打开系统分享面板。';
  }
  byId('shoot-shutter').disabled = phase !== 'live' || state.capturing;
  byId('shoot-flip').disabled = phase !== 'live' || state.capturing;
  byId('shoot-retry').hidden = !canRetry;
  if (phase === 'error') {
    const target = byId(canRetry ? 'shoot-retry' : 'shoot-close');
    if (document.activeElement !== target) target.focus();
  }
  applyGrid();
  if (phase === 'starting') keepFocusInside('shoot-close');
  if (phase === 'live') keepFocusInside('shoot-shutter');
  applyRef();
}

function keepFocusInside(fallbackId) {
  const active = document.activeElement;
  if (!active || active === document.body || active.closest('[hidden]')) byId(fallbackId).focus();
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
      if (state.phase === 'live' && token === state.token) capture();
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

function onShutter() {
  if (state.phase !== 'live' || state.capturing || state.countdown != null) return;
  if (state.delay) startCountdown(state.delay);
  else capture();
}

function fail(key) {
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

function clearPhoto() {
  if (state.url) URL.revokeObjectURL(state.url);
  state.url = '';
  state.blob = null;
  state.name = '';
  state.capturing = false;
  byId('shoot-result').removeAttribute('src');
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
  showNotice(state.facing === 'user' ? FRONT_NOTE : '');
}

function setupTorch(track) {
 const row = byId('shoot-torch-row');
 const box = byId('shoot-torch');
 const capabilities = track?.getCapabilities?.() ?? {};
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

async function capture() {
  const video = byId('shoot-video');
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (state.phase !== 'live' || state.capturing || !width || !height) {
    showNotice('相机还没准备好，请稍等一下。');
    return;
  }
  const token = state.token;
  state.capturing = true;
  setPhase('live');
  showNotice('正在生成照片…');
  const track = state.stream?.getVideoTracks()[0];
  const settings = track?.getSettings?.() ?? {};
  if (track && 'ImageCapture' in window && (settings.width ?? 0) >= 1280) {
    try {
      const blob = await processCaptured(await new ImageCapture(track).takePhoto());
      if (token !== state.token || state.phase !== 'live' || !state.capturing) return;
      state.capturing = false;
      showReview(blob);
      return;
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
  canvas.toBlob((blob) => {
    if (token !== state.token || state.phase !== 'live' || !state.capturing) return;
    state.capturing = false;
    if (blob) showReview(blob);
    else {
      setPhase('live');
      showNotice('拍照失败，请重试。');
    }
  }, 'image/jpeg', state.settings.quality);
}

async function showReview(blob, name = '') {
  state.token += 1;
  stopStream();
  clearPhoto();
  state.name = name;
  state.compare = false;
  state.blob = blob.type ? blob : blob.slice(0, blob.size, typeFor(name, blob.type));
  const photo = state.blob;
  state.url = URL.createObjectURL(photo);
  setPhase('review');
  showNotice(name ? `已选择 ${name}，确认后保存或分享。` : '拍好了。可以重拍，或保存、分享。');
  byId('shoot-save').focus();
  let src = state.url;
  if (isWeChat() || isMobile()) {
    try {
      src = await readDataUrl(photo);
    } catch (error) {
      console.warn('Unable to prepare the photo for long-press saving', error);
    }
  }
  if (state.blob !== photo) return;
  byId('shoot-result').src = src;
}

function fileName(type) {
  const now = new Date();
  const two = (value) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return `pose-${stamp}.${EXTENSIONS[type] ?? 'jpg'}`;
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
  const name = state.name || fileName(state.blob.type);
  const type = typeFor(name, state.blob.type);
  return new File([state.blob], name, { type });
}

function savePhoto() {
  if (!state.blob) return;
  if (isWeChat() || isMobile()) {
    showNotice('保存：长按上方照片，选择“保存图片/存储图像”，也可以发送给朋友。');
    byId('shoot-result').scrollIntoView({ block: 'center' });
    return;
  }
  if (!state.url) return;
  download(photoFile());
}

async function sharePhoto() {
  if (!state.blob) return;
  const file = photoFile();
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: state.pose?.name ?? '照片' });
      showNotice('已交给系统分享面板。');
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
      console.warn('Sharing failed', error);
    }
  }
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
  const ref = byId('shoot-ref');
  ref.src = GALLERY_IMAGE_ROOT + entry.path;
  ref.alt = `${POSTURE_LABELS[entry.posture]}${ANGLE_LABELS[entry.angle]}的人偶线稿姿势参考`;
  applyRef();
  closePicker();
  showNotice(`已选参考图：${POSTURE_LABELS[entry.posture]} · ${ANGLE_LABELS[entry.angle]}。可以切换角落、叠加或隐藏。`);
  byId('shoot-ref-library').focus();
}

function openPicker() {
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
  byId('shoot-native').addEventListener('click', () => byId('shoot-file').click());
  byId('shoot-file').addEventListener('change', useSystemPhoto);
  byId('shoot-ref').addEventListener('error', () => { state.hasRef = false; applyRef(); });
  byId('shoot-result').addEventListener('load', () => {
    if (state.phase !== 'review' || !state.blob) return;
    const image = byId('shoot-result');
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
  byId('shoot-settings-reset').addEventListener('click', () => {
    state.settings = { aspect: 'source', quality: 0.92, mirrorSave: false, refOpacity: 0.45, refScale: 1 };
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
