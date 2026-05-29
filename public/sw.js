// Простой Service Worker для прохождения проверки PWA
self.addEventListener('install', (e) => {
    console.log('[SW] Приложение установлено');
    self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
    // Оставляем пустым, чтобы все запросы шли напрямую к нашему серверу
});