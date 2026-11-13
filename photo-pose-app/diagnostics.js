const MAX_EVENTS = 24;
const events = [];
let meta = { version: '', catalogCount: 0 };

export function setDiagnosticsMeta(next) {
  meta = { ...meta, ...next };
}

export function recordEvent(type, detail = '') {
  events.push({
    at: new Date().toISOString(),
    type: String(type).slice(0, 40),
    detail: String(detail).slice(0, 180),
  });
  if (events.length > MAX_EVENTS) events.shift();
}

export async function diagnosticsSnapshot() {
  let cacheNames = [];
  let registered = false;
  try {
    cacheNames = (await caches.keys()).filter((key) => key.startsWith('pose-notes-'));
  } catch {
    // Private modes and blocked storage may refuse the cache list.
  }
  try {
    registered = Boolean(await navigator.serviceWorker?.getRegistration());
  } catch {
    // The diagnostics view must still render when registration lookup fails.
  }
  return {
    version: meta.version,
    catalogCount: meta.catalogCount,
    secure: window.isSecureContext,
    online: navigator.onLine,
    language: navigator.language,
    viewport: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio || 1}`,
    userAgent: navigator.userAgent,
    serviceWorkerRegistered: registered,
    serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
    cameraApi: Boolean(navigator.mediaDevices?.getUserMedia),
    imageCapture: 'ImageCapture' in window,
    shareFiles: Boolean(navigator.canShare),
    caches: cacheNames,
    events: events.map((event) => ({ ...event })),
  };
}

export function diagnosticsText(snapshot) {
  return [
    `Pose Notes ${snapshot.version || 'v?'} · ${snapshot.catalogCount || '?'} 条动作`,
    `安全上下文: ${snapshot.secure ? '是' : '否'} · 在线: ${snapshot.online ? '是' : '否'} · 语言: ${snapshot.language}`,
    `视口: ${snapshot.viewport} · Service Worker: ${snapshot.serviceWorkerRegistered ? '已注册' : '未注册'} / ${snapshot.serviceWorkerControlled ? '已控制' : '未控制'}`,
    `相机 API: ${snapshot.cameraApi ? '有' : '无'} · ImageCapture: ${snapshot.imageCapture ? '有' : '无'} · 文件分享: ${snapshot.shareFiles ? '有' : '无'}`,
    `缓存: ${snapshot.caches.length ? snapshot.caches.join(', ') : '无'}`,
    `UA: ${snapshot.userAgent}`,
    '事件:',
    ...snapshot.events.map((event) => `- ${event.at} ${event.type}${event.detail ? `: ${event.detail}` : ''}`),
  ].join('\n');
}
