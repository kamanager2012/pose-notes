const byId = (id) => document.getElementById(id);
const status = byId('status-message');
const statusText = byId('status-text');
const networkStatus = byId('network-status');
const labels = {
  people: { 1: '单人', 2: '双人', 3: '三人', 4: '四人' },
  tiers: { everyday: '日常', style: '风格', contextual: '场景限定' },
};

const angleLabels = { front: '正面', diag: '斜侧', side: '侧面', back: '背面', above: '俯视', below: '仰视' };
const GALLERY_DATA_URL = '../reference-library/photo-pose-gallery.json';
const GALLERY_IMAGE_ROOT = '../reference-library/poses-shisei-v0.4.1/';
const GALLERY_IMAGE_PATH = /^(std|upper)\/(line|photo)\/[A-Za-z0-9_]+\.webp$/;
const postureLabels = { standing: '站姿', sitting: '坐姿', squatting: '蹲姿', lying: '躺姿', upper: '半身动作' };
let viewerState = null;
let galleryEntries = [];
let galleryLimit = 24;
let galleryRequest = 0;
let galleryReady = false;

function updateNetworkStatus() {
  const online = navigator.onLine;
  networkStatus.textContent = online ? '在线 · 离线缓存状态未知' : '离线 · 仅可用已缓存内容';
  networkStatus.dataset.online = String(online);
  checkOfflineStatus(navigator.serviceWorker?.controller);
}

function checkOfflineStatus(worker) {
  if (worker) worker.postMessage('offline-status');
}

let updateRequested = false;
const updateBanner = byId('update-banner');
const updateButton = byId('update-button');

function offerUpdate(registration) {
  if (navigator.serviceWorker.controller && registration.waiting) updateBanner.hidden = false;
}

function watchForUpdate(registration) {
  offerUpdate(registration);
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') offerUpdate(registration);
    });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') registration.update().catch((error) => console.warn('Update check failed', error));
  });
}

updateButton.addEventListener('click', async () => {
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration?.waiting) {
    updateBanner.hidden = true;
    return;
  }
  updateRequested = true;
  updateButton.disabled = true;
  registration.waiting.postMessage('skip-waiting');
  setTimeout(() => { updateButton.disabled = false; }, 10000);
});

updateNetworkStatus();
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'update-blocked') {
      updateRequested = false;
      updateButton.disabled = false;
      byId('update-text').textContent = '新版本尚未准备好，请保持联网后重试。';
      return;
    }
    if (event.data?.type !== 'offline-status') return;
    networkStatus.textContent = navigator.onLine
      ? event.data.ready ? '在线 · 离线基础内容已缓存' : '在线 · 离线缓存未就绪'
      : event.data.ready ? '离线 · 可用基础内容和已缓存图片' : '离线 · 缓存可能不完整';
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updateRequested) {
      updateRequested = false;
      window.location.reload();
      return;
    }
    checkOfflineStatus(navigator.serviceWorker.controller);
  });
  navigator.serviceWorker.register('./service-worker.js')
    .then((registration) => {
      watchForUpdate(registration);
      return navigator.serviceWorker.ready;
    })
    .then((registration) => checkOfflineStatus(registration.active))
    .catch((error) => {
      networkStatus.textContent = navigator.onLine ? '在线 · 离线缓存不可用' : '离线 · 缓存可能不完整';
      console.error('Unable to register offline support', error);
    });
}

async function loadGallery() {
  const requestId = ++galleryRequest;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  const message = byId('gallery-status');
  byId('gallery-retry').hidden = true;
  message.textContent = '正在读取图片…';
  try {
    const response = await fetch(GALLERY_DATA_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data?.version !== 1 || !Array.isArray(data.groups)) throw new TypeError('Invalid image catalog');
    if (requestId !== galleryRequest) return;
    galleryEntries = data.groups.filter((entry) => ['std', 'upper'].includes(entry.series)
      && Object.hasOwn(postureLabels, entry.posture));
    galleryReady = true;
    renderGallery();
  } catch (error) {
    if (requestId !== galleryRequest) return;
    console.error('Unable to load pose image catalog', error);
    message.textContent = error.name === 'AbortError' ? '读取图片目录超时，请检查连接后重试。' : '图片目录加载失败，请检查连接后重试。';
    byId('gallery-retry').hidden = false;
  } finally {
    clearTimeout(timeout);
  }
}

function renderGallery() {
  if (!galleryReady) return;
  const type = byId('gallery-type').value;
  const series = byId('gallery-series').value;
  const posture = byId('gallery-posture').value;
  const field = type === 'photo' ? 'photos' : 'views';
  const entries = galleryEntries.map((entry) => ({
    series: entry.series,
    posture: entry.posture,
    images: Object.entries(entry[field] || {}).filter(([angle, path]) =>
      Object.hasOwn(angleLabels, angle) && typeof path === 'string' && GALLERY_IMAGE_PATH.test(path)),
  })).filter((entry) => entry.images.length && (series === 'all' || entry.series === series)
    && (posture === 'all' || entry.posture === posture));
  const list = byId('gallery-list');
  list.replaceChildren();
  byId('gallery-status').textContent = `${entries.length} 组姿势 · 显示 ${Math.min(galleryLimit, entries.length)} 组`;
  byId('gallery-more').hidden = galleryLimit >= entries.length;
  for (const entry of entries.slice(0, galleryLimit)) {
    const figure = document.createElement('figure');
    figure.className = 'gallery-card';
    const image = document.createElement('img');
    image.loading = 'lazy';
    const imageError = document.createElement('p');
    imageError.hidden = true;
    imageError.setAttribute('role', 'status');
    imageError.append('图片加载失败。 ');
    const imageRetry = document.createElement('button');
    imageRetry.type = 'button';
    imageRetry.textContent = '重试图片';
    imageError.append(imageRetry);
    const caption = document.createElement('figcaption');
    const text = document.createElement('span');
    text.textContent = `${postureLabels[entry.posture]} · ${type === 'photo' ? 'AI 图片' : '线稿'}`;
    const select = document.createElement('select');
    select.setAttribute('aria-label', '选择参考角度');
    for (const [angle] of entry.images) {
      const option = document.createElement('option');
      option.value = angle;
      option.textContent = angleLabels[angle];
      select.append(option);
    }
    const show = () => {
      const [angle, path] = entry.images.find(([key]) => key === select.value);
      imageError.hidden = true;
      image.src = GALLERY_IMAGE_ROOT + path;
      image.alt = `${text.textContent}姿势参考，${angleLabels[angle]}视角`;
    };
    select.addEventListener('change', show);
    imageRetry.addEventListener('click', show);
    image.addEventListener('load', () => { imageError.hidden = true; });
    image.addEventListener('error', () => { image.alt = '图片加载失败'; imageError.hidden = false; });
    show();
    caption.append(text, select);
    const enlarge = document.createElement('button');
    enlarge.className = 'gallery-enlarge';
    enlarge.type = 'button';
    enlarge.textContent = '放大查看';
    enlarge.setAttribute('aria-label', `放大查看${text.textContent}`);
    enlarge.addEventListener('click', () => openGalleryViewer(entry, type, select.value));
    caption.append(enlarge);
    figure.append(image, imageError, caption);
    list.append(figure);
  }
}

function openGalleryViewer(entry, type, selectedAngle) {
  const dialog = byId('gallery-viewer');
  const images = entry.images;
  const angleSelect = byId('viewer-angle');
  angleSelect.replaceChildren();
  for (const [angle] of images) {
    const option = document.createElement('option');
    option.value = angle;
    option.textContent = angleLabels[angle];
    angleSelect.append(option);
  }
  angleSelect.value = images.some(([angle]) => angle === selectedAngle) ? selectedAngle : images[0][0];
  byId('viewer-title').textContent = `${postureLabels[entry.posture]}姿势参考`;
  byId('viewer-caption').textContent = `${entry.series === 'std' ? '全身' : '上半身'} · ${type === 'photo' ? 'AI 图片' : '人偶线稿'}`;
  byId('viewer-note').hidden = type !== 'photo';
  viewerState = { entry, type, images };
  updateGalleryViewer();
  dialog.showModal();
}

function updateGalleryViewer() {
  if (!viewerState) return;
  const angle = byId('viewer-angle').value;
  const path = viewerState.images.find(([key]) => key === angle)?.[1];
  byId('viewer-error').hidden = true;
  byId('viewer-image').src = GALLERY_IMAGE_ROOT + path;
  byId('viewer-image').alt = `${byId('viewer-caption').textContent}，${angleLabels[angle]}视角`;
}

byId('viewer-image').addEventListener('error', () => { byId('viewer-error').hidden = false; });
byId('viewer-image').addEventListener('load', () => { byId('viewer-error').hidden = true; });
byId('viewer-retry').addEventListener('click', updateGalleryViewer);
byId('viewer-angle').addEventListener('change', updateGalleryViewer);
byId('viewer-close').addEventListener('click', () => byId('gallery-viewer').close());
byId('gallery-viewer').addEventListener('click', (event) => {
  if (event.target === byId('gallery-viewer')) byId('gallery-viewer').close();
});
byId('gallery-viewer').addEventListener('close', () => { viewerState = null; });

for (const id of ['gallery-type', 'gallery-series', 'gallery-posture']) {
  byId(id).addEventListener('change', () => { galleryLimit = 24; renderGallery(); });
}
byId('gallery-more').addEventListener('click', () => { galleryLimit += 24; renderGallery(); });
byId('gallery-retry').addEventListener('click', loadGallery);
let galleryRequested = false;
byId('gallery-panel').addEventListener('toggle', (event) => {
  if (!event.target.open || galleryRequested) return;
  galleryRequested = true;
  loadGallery();
});
if (byId('gallery-panel').open) byId('gallery-panel').dispatchEvent(new Event('toggle'));

let loadRequest = 0;
let retryTimer;
let reloadOnRetry = false;
const FAVORITES_KEY = 'pose-notes-favorites-v1';
let favorites = readFavorites();
let favoritesOnly = false;

function readFavorites() {
  try {
    const value = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]');
    return new Set(Array.isArray(value) && value.every((id) => typeof id === 'string') ? value : []);
  } catch {
    return new Set();
  }
}

function saveFavorites() {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
  } catch {
    const warning = byId('storage-warning');
    warning.hidden = false;
    warning.textContent = '浏览器未允许保存收藏；本次页面内仍可查看收藏状态。';
  }
  byId('favorite-count').textContent = String(favorites.size);
}

function setError(message, canRetry) {
  byId('result-count').textContent = '目录暂不可用';
  status.hidden = false;
  statusText.textContent = message;
  byId('retry-button').hidden = !canRetry;
}

async function init() {
  const requestId = ++loadRequest;
  clearTimeout(retryTimer);
  byId('retry-button').disabled = true;
  byId('result-count').textContent = '正在读取…';
  status.hidden = false;
  statusText.textContent = '正在读取动作目录。';
  byId('retry-button').hidden = true;

  try {
    const { recommendPhotoPoses } = await import('../reference-library/photo-pose-recommendations.mjs');
    const controller = new AbortController();
    retryTimer = setTimeout(() => controller.abort(), 10000);
    const response = await fetch('../reference-library/photo-pose-selection.json', { signal: controller.signal, cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const catalog = await response.json();
    clearTimeout(retryTimer);
    validateCatalog(catalog);
    if (requestId !== loadRequest) return;
    status.hidden = true;
    reloadOnRetry = true;
    mount(catalog, recommendPhotoPoses);
    reloadOnRetry = false;
  } catch (error) {
    if (requestId !== loadRequest) return;
    console.error('Unable to load photo pose catalog', error);
    const message = error.name === 'AbortError'
      ? '读取动作目录超时。检查网络连接后重试。'
      : reloadOnRetry ? '页面初始化失败，请重试以重新加载页面。' : '动作目录加载失败。请检查连接后重试。';
    setError(message, true);
  } finally {
    clearTimeout(retryTimer);
    if (requestId === loadRequest) byId('retry-button').disabled = false;
  }
}

async function startShoot(pose, opener) {
  try {
    const { openShoot } = await import('./shoot.js');
    openShoot(pose, opener);
  } catch (error) {
    console.error('Unable to load the camera view', error);
    status.hidden = false;
    statusText.textContent = '相机界面加载失败，请检查连接后重试。动作目录不受影响。';
  }
}

function validateCatalog(catalog) {
  if (!catalog || catalog.version !== 4 || !Array.isArray(catalog.poses)
    || !Array.isArray(catalog.guideBasedPoses) || !catalog.recommendationOptions) {
    throw new TypeError('Unsupported or malformed photo pose catalog');
  }
  const poses = [...catalog.poses, ...catalog.guideBasedPoses];
  if (!poses.length || poses.length !== catalog.summary?.totalInstructions
    || poses.some((pose) => !pose.recommendation || !Array.isArray(pose.steps)
    || pose.steps.length !== 3 || !pose.name || !pose.cue || !pose.camera || !pose.quickCheck)) {
    throw new TypeError('Photo pose catalog failed its content checks');
  }
}

function mount(catalog, recommendPhotoPoses) {
const state = { peopleCount: 1, context: '', posture: '', framing: '', availableFeatures: [], includeStyles: false };
const allPoses = [...catalog.poses, ...catalog.guideBasedPoses];
byId('catalog-version').textContent = `v${catalog.version} · ${allPoses.length} 条`;
byId('catalog-count').textContent = String(allPoses.length);
byId('about-version').textContent = `v${catalog.version} · ${allPoses.length} 条动作`;

function updateAdvancedSummary() {
  const selected = [state.posture, state.framing, ...state.availableFeatures];
  const activeCount = selected.filter(Boolean).length + (state.includeStyles ? 1 : 0);
  byId('advanced-summary').textContent = activeCount ? `${activeCount} 项已选` : '姿态、构图、现场条件';
}

function setupOptions() {
  const contextSelect = byId('context-select');
  for (const [value, label] of Object.entries(catalog.recommendationOptions.contexts)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    contextSelect.append(option);
  }

  for (const [id, label] of Object.entries(catalog.recommendationOptions.postures)) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = label;
    byId('posture-select').append(option);
  }
  for (const [id, label] of Object.entries(catalog.recommendationOptions.framing)) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = label;
    byId('framing-select').append(option);
  }

  const featureContainer = byId('feature-options');
  for (const [value, labelText] of Object.entries(catalog.recommendationOptions.features)) {
    const label = document.createElement('label');
    label.className = 'feature-option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = value;
    const box = document.createElement('span');
    box.className = 'check-box';
    box.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = labelText;
    label.append(input, box, text);
    featureContainer.append(label);
  }
}

function recommend() {
  return recommendPhotoPoses(catalog, {
    peopleCount: state.peopleCount,
    context: state.context || undefined,
    posture: state.posture || undefined,
    framing: state.framing || undefined,
    availableFeatures: state.availableFeatures,
    includeStyles: state.includeStyles,
    limit: favoritesOnly ? allPoses.length : 12,
    deduplicateFamilies: !favoritesOnly,
  });
}

function tagLabel(value) {
  return catalog.recommendationOptions.contexts[value] ?? labels.tiers[value] ?? value;
}

function render() {
  const poses = recommend().filter((pose) => !favoritesOnly || favorites.has(pose.id));
  const list = byId('pose-list');
  const count = byId('result-count');
  count.textContent = `${poses.length} 条匹配`;
  list.innerHTML = '';

  const hasContextualMissing = !state.context && allPoses.some((pose) => pose.recommendation.peopleCount === state.peopleCount && pose.recommendation.tier === 'contextual');
  if (!poses.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const message = favoritesOnly && !favorites.size
      ? '点动作卡片上的星标即可保存到本机。'
      : favoritesOnly ? '当前筛选条件下没有收藏动作。' : !state.context
        ? '选择拍摄场景可查看限定场景动作。'
        : '当前筛选条件没有匹配项。可将姿态或构图改为不限，或更换场景；现场条件只勾选实际具备的。';
    const title = document.createElement('strong');
    title.textContent = favoritesOnly ? '没有符合条件的收藏。' : '还没有合适的起手式。';
    const detail = document.createElement('p');
    detail.textContent = message;
    empty.append(title, detail);
    list.append(empty);
  } else {
    poses.forEach((pose, index) => list.append(card(pose, index)));
  }
  status.hidden = !hasContextualMissing || Boolean(state.context);
  statusText.textContent = '有些动作需要明确拍摄场景才会出现。选一个场景，旅行、商务和生活方式的动作就会加入结果。';
}

function card(pose, index) {
  const recommendation = pose.recommendation;
  const article = document.createElement('article');
  article.className = 'pose-card';
  const top = document.createElement('div');
  top.className = 'pose-card-top';
  const indexLabel = document.createElement('span');
  indexLabel.className = 'pose-index';
  indexLabel.textContent = `${String(index + 1).padStart(2, '0')} / ${labels.people[recommendation.peopleCount]}`;
  const tags = document.createElement('div');
  tags.className = 'pose-tags';
  for (const label of [labels.tiers[recommendation.tier], tagLabel(recommendation.contexts[0])]) {
    const tag = document.createElement('span');
    tag.className = 'pose-tag';
    tag.textContent = label;
    tags.append(tag);
  }
  top.append(indexLabel, tags);
  const title = document.createElement('h3');
  title.textContent = pose.name;
  let reference = null;
  const referenceSrc = pose.previewImage ?? pose.diagram;
  if (referenceSrc) {
    const isDiagram = !pose.previewImage;
    reference = document.createElement('figure');
    reference.className = 'pose-reference';
    const image = document.createElement('img');
    image.src = referenceSrc;
    image.alt = isDiagram ? `${pose.name}的站位示意图` : `${pose.name}的人偶线稿姿势参考`;
    image.loading = 'lazy';
    image.addEventListener('error', () => reference.remove(), { once: true });
    const caption = document.createElement('figcaption');
    caption.textContent = isDiagram ? '站位示意图 · 原创线条，不是实拍示范' : '姿势参考 · 人偶线稿，非实拍示范';
    reference.append(image, caption);
  }
  const favorite = document.createElement('button');
  favorite.className = 'favorite-button';
  favorite.type = 'button';
  favorite.setAttribute('aria-pressed', String(favorites.has(pose.id)));
  favorite.setAttribute('aria-label', `${favorites.has(pose.id) ? '取消收藏' : '收藏'}${pose.name}`);
  favorite.textContent = favorites.has(pose.id) ? '★' : '☆';
  favorite.addEventListener('click', () => {
    if (favorites.has(pose.id)) favorites.delete(pose.id);
    else favorites.add(pose.id);
    saveFavorites();
    if (favoritesOnly) render();
    else {
      const selected = favorites.has(pose.id);
      favorite.setAttribute('aria-pressed', String(selected));
      favorite.setAttribute('aria-label', `${selected ? '取消收藏' : '收藏'}${pose.name}`);
      favorite.textContent = selected ? '★' : '☆';
    }
  });
  const cue = document.createElement('p');
  cue.className = 'pose-cue';
  cue.textContent = `“${pose.cue}”`;
  const detail = document.createElement('div');
  detail.className = 'pose-detail';
  const cameraBlock = document.createElement('div');
  const cameraLabel = document.createElement('span');
  cameraLabel.className = 'pose-detail-label';
  cameraLabel.textContent = '摄影者提醒';
  const cameraText = document.createElement('p');
  cameraText.className = 'pose-detail-text';
  cameraText.textContent = pose.camera;
  cameraBlock.append(cameraLabel, cameraText);
  const open = document.createElement('button');
  open.className = 'pose-open';
  open.type = 'button';
  open.setAttribute('aria-expanded', 'false');
  open.setAttribute('aria-label', `查看${pose.name}完整步骤`);
  open.textContent = '＋';
  const extra = document.createElement('div');
  extra.className = 'pose-extra';
  const extraLabel = document.createElement('span');
  extraLabel.className = 'pose-detail-label';
  extraLabel.textContent = '三步完成';
  const steps = document.createElement('ol');
  for (const step of pose.steps) {
    const item = document.createElement('li');
    item.textContent = step;
    steps.append(item);
  }
  const check = document.createElement('p');
  check.textContent = `检查：${pose.quickCheck}`;
  extra.append(extraLabel, steps, check);
  const shoot = document.createElement('button');
  shoot.className = 'pose-shoot';
  shoot.type = 'button';
  shoot.textContent = '拍这个';
  shoot.setAttribute('aria-label', `用相机拍${pose.name}`);
  shoot.addEventListener('click', () => startShoot(pose, shoot));
  detail.append(cameraBlock, open, extra);
  article.append(top, favorite, title, cue);
  if (reference) article.append(reference);
  article.append(detail, shoot);
  open.addEventListener('click', (event) => {
    const expanded = event.currentTarget.getAttribute('aria-expanded') === 'true';
    event.currentTarget.setAttribute('aria-expanded', String(!expanded));
    event.currentTarget.textContent = expanded ? '＋' : '−';
    event.currentTarget.setAttribute('aria-label', `${expanded ? '查看' : '收起'}${pose.name}完整步骤`);
    extra.classList.toggle('is-open', !expanded);
  });
  return article;
}

function update() { render(); }

byId('people-options').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-value]');
  if (!button) return;
  state.peopleCount = Number(button.dataset.value);
  document.querySelectorAll('#people-options button').forEach((item) => {
    item.classList.toggle('is-selected', item === button);
    item.setAttribute('aria-pressed', String(item === button));
  });
  update();
});
byId('context-select').addEventListener('change', (event) => { state.context = event.target.value; update(); });
byId('posture-select').addEventListener('change', (event) => { state.posture = event.target.value; update(); });
byId('framing-select').addEventListener('change', (event) => { state.framing = event.target.value; update(); });
byId('feature-options').addEventListener('change', (event) => {
  if (!event.target.matches('input')) return;
  state.availableFeatures = [...byId('feature-options').querySelectorAll('input:checked')].map((input) => input.value);
  update();
});
byId('style-checkbox').addEventListener('change', (event) => { state.includeStyles = event.target.checked; update(); });
byId('reset-button').addEventListener('click', () => {
  state.peopleCount = 1; state.context = ''; state.posture = ''; state.framing = ''; state.availableFeatures = []; state.includeStyles = false;
  byId('context-select').value = '';
  byId('posture-select').value = '';
  byId('framing-select').value = '';
  byId('style-checkbox').checked = false;
  byId('feature-options').querySelectorAll('input').forEach((input) => { input.checked = false; });
  document.querySelectorAll('#people-options button').forEach((item) => {
    const selected = item.dataset.value === '1';
    item.classList.toggle('is-selected', selected);
    item.setAttribute('aria-pressed', String(selected));
  });
  byId('advanced-filters').open = false;
  updateAdvancedSummary();
  update();
});

setupOptions();
byId('favorite-count').textContent = String(favorites.size);
byId('favorites-filter').addEventListener('click', (event) => {
  favoritesOnly = !favoritesOnly;
  event.currentTarget.setAttribute('aria-pressed', String(favoritesOnly));
  event.currentTarget.textContent = `${favoritesOnly ? '★ 收藏中' : '☆ 收藏'} `;
  const count = document.createElement('span');
  count.id = 'favorite-count';
  count.textContent = String(favorites.size);
  event.currentTarget.append(count);
  render();
});
byId('advanced-filters').open = !window.matchMedia('(max-width: 570px)').matches;
byId('posture-select').addEventListener('change', updateAdvancedSummary);
byId('framing-select').addEventListener('change', updateAdvancedSummary);
byId('feature-options').addEventListener('change', updateAdvancedSummary);
byId('style-checkbox').addEventListener('change', updateAdvancedSummary);
updateAdvancedSummary();
render();
}

byId('about-open').addEventListener('click', () => byId('about-dialog').showModal());
byId('about-close').addEventListener('click', () => byId('about-dialog').close());
byId('about-dialog').addEventListener('click', (event) => {
  if (event.target === byId('about-dialog')) byId('about-dialog').close();
});

byId('retry-button').addEventListener('click', () => {
  if (reloadOnRetry) window.location.reload();
  else init();
});
init();
