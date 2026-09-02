const CACHE = 'sanguosha-v1.6.3';
// 注意：不要把 config.js 放进预缓存列表——它是 gitignored 文件，fresh clone 时不存在，
// addAll 遇到 404 会让整个 SW 安装失败；config.js 由 fetch 处理器运行时按需缓存。
const ASSETS = [
  './',
  './index.html',
  './data.js',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 核心文件走 network-first：有网即拿最新版（自动更新），离线回退缓存
const NETWORK_FIRST = [
  './',
  './index.html',
  './app.js',
  './data.js',
  './sw.js',
  './config.js'
];

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const path = './' + url.pathname.split('/').pop();
  const isCore = e.request.method === 'GET' &&
    (url.origin === location.origin) &&
    NETWORK_FIRST.some(p => path === p || (p === './' && url.pathname.split('/').pop() === ''));

  if (isCore) {
    // network-first：在线拿最新并更新缓存，失败回退缓存
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request).then(r => r || Response.error()))
    );
  } else {
    // 静态资源 cache-first
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return res;
      }))
    );
  }
});
