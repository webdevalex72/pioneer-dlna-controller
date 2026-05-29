const axios = require('axios');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// Подключаем наши модули
const pioneer = require('./pioneerService');
const dlna = require('./dlnaService');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

app.use(express.static(path.join(__dirname, 'public')));

// 1. Пробрасываем события от Pioneer в браузеры
pioneer.onStatus = (connected) => io.emit('pioneer-status', { connected });
pioneer.onStateChange = (device, value) => io.emit('state-change', { device, value });
pioneer.onLog = (msg) => io.emit('pioneer-raw-log', msg);

// URL управления движком воспроизведения Pioneer
const RENDERER_URL = 'http://192.168.1.129:8080/AVTransport/ctrl';

// Универсальная функция для отправки DLNA-команд (Play, Pause, Stop, Next, Prev)
async function sendDlnaTransport(actionName, extraBody = '') {
    const body = `<?xml version="1.0" encoding="utf-8"?>
    <s:Envelope s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
      <s:Body>
        <u:${actionName} xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
          <InstanceID>0</InstanceID>
          ${extraBody}
        </u:${actionName}>
      </s:Body>
    </s:Envelope>`;

    try {
        await axios.post(RENDERER_URL, body, {
            headers: {
                'Content-Type': 'text/xml; charset="utf-8"',
                'SOAPAction': `"urn:schemas-upnp-org:service:AVTransport:1#${actionName}"`
            }
        });
        console.log(`[DLNA] Команда ${actionName} успешно отправлена на плеер!`);
    } catch (e) {
        console.error(`[DLNA] Ошибка команды ${actionName}:`, e.message);
    }
}

// ДОБАВЛЯЕМ ПЕРЕМЕННУЮ ДЛЯ ХРАНЕНИЯ ТЕКУЩЕГО ХОЗЯИНА
let activeSocket = null;

// 2. Взаимодействие с браузерами
io.on('connection', (socket) => {

    // --- ЛОГИКА ЕДИНОГО ПОДКЛЮЧЕНИЯ (ПЕРЕХВАТ) ---
    if (activeSocket && activeSocket.id !== socket.id) {
        console.log(`[WS] Внимание! Перехват управления. Отключаем старое устройство: ${activeSocket.id}`);
        // Отправляем старому устройству команду на блокировку экрана
        activeSocket.emit('access-denied', 'Управление перехвачено другим устройством.');
        // Принудительно рвем старое соединение
        activeSocket.disconnect(true);
    }

    // Назначаем новое устройство главным
    activeSocket = socket;
    console.log(`[WS] Браузер подключился (Активный пульт): ${socket.id}`);
    // ----------------------------------------------

    socket.emit('pioneer-status', { connected: pioneer.isConnected });
    socket.emit('state-change', { device: 'power', value: pioneer.powerState });

    // ... (здесь остается весь твой существующий код обработчиков socket.on) ...

    // ДОБАВИТЬ ЭТУ СТРОКУ: Отправляем статус питания при загрузке страницы
    socket.emit('state-change', { device: 'power', value: pioneer.powerState });

    // Обработка кнопок интерфейса
    socket.on('ui-command', (action) => {
        switch (action) {
            case 'power_toggle':
                // Отправляем PF если включен, или PO если выключен
                const powerCmd = pioneer.powerState === 'ON' ? 'PF' : 'PO';
                console.log(`[TCP] Запрос изменения питания: отправляем ${powerCmd}`);
                pioneer.sendCmd(powerCmd);
                // Через секунду запрашиваем новый статус, чтобы обновить UI
                setTimeout(() => pioneer.sendCmd('?P'), 1000);
                break;

            case 'play': sendDlnaTransport('Play', '<Speed>1</Speed>'); break;
            case 'pause': sendDlnaTransport('Pause'); break;
            case 'stop': sendDlnaTransport('Stop'); break;
        }
    });

    // Обработка клика по треку в списках
    socket.on('play-track', async (track) => {
        try {
            console.log(`\n[DLNA] 1. Подготовка трека: ${track.title}`);

            const escapeXml = (unsafe) => unsafe ? unsafe.toString().replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '\'': '&apos;', '"': '&quot;' }[c])) : '';

            const safeUrl = escapeXml(track.url);
            const safeTitle = escapeXml(track.title);
            const safeArtist = escapeXml(track.artist);

            // ФОРМИРУЕМ "ПАСПОРТ" ТРЕКА (DIDL-Lite)
            // Это скажет Пионеру, что это локальный файл, а не радио
            const didl = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:dlna="urn:schemas-dlna-org:metadata-1-0/"><item id="${escapeXml(track.id)}" parentID="-1" restricted="1"><dc:title>${safeTitle}</dc:title><upnp:artist>${safeArtist}</upnp:artist><upnp:class>object.item.audioItem.musicTrack</upnp:class><res protocolInfo="${escapeXml(track.protocolInfo)}" duration="${escapeXml(track.duration)}" size="${escapeXml(track.size)}">${safeUrl}</res></item></DIDL-Lite>`;

            // Экранируем весь паспорт для вставки в SOAP запрос
            const safeMetadata = escapeXml(didl);

            const setUriBody = `<?xml version="1.0" encoding="utf-8"?>
            <s:Envelope s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
              <s:Body>
                <u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
                  <InstanceID>0</InstanceID>
                  <CurrentURI>${safeUrl}</CurrentURI>
                  <CurrentURIMetaData>${safeMetadata}</CurrentURIMetaData>
                </u:SetAVTransportURI>
              </s:Body>
            </s:Envelope>`;

            await axios.post(RENDERER_URL, setUriBody, {
                headers: { 'Content-Type': 'text/xml; charset="utf-8"', 'SOAPAction': '"urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI"' }
            });

            console.log('[DLNA] 2. Ссылка и метаданные загружены. Кэширование 1 сек...');

            setTimeout(() => {
                console.log('[DLNA] 3. Отправляем команду PLAY...');
                sendDlnaTransport('Play', '<Speed>1</Speed>');
            }, 1000);

        } catch (err) {
            console.error('[DLNA Play Ошибка]', err.response ? err.response.data : err.message);
        }
    });

    // --- ПРОГРАММНАЯ ПАУЗА (ВОЗОБНОВЛЕНИЕ) ---
    socket.on('resume-track', async (data) => {
        try {
            console.log(`\n[DLNA] 1. Снятие с паузы: ${data.track.title} (отметка ${data.time})`);

            const escapeXml = (unsafe) => unsafe ? unsafe.toString().replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '\'': '&apos;', '"': '&quot;' }[c])) : '';
            const safeUrl = escapeXml(data.track.url);
            const safeTitle = escapeXml(data.track.title);
            const safeArtist = escapeXml(data.track.artist);

            const didl = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:dlna="urn:schemas-dlna-org:metadata-1-0/"><item id="${escapeXml(data.track.id)}" parentID="-1" restricted="1"><dc:title>${safeTitle}</dc:title><upnp:artist>${safeArtist}</upnp:artist><upnp:class>object.item.audioItem.musicTrack</upnp:class><res protocolInfo="${escapeXml(data.track.protocolInfo)}" duration="${escapeXml(data.track.duration)}" size="${escapeXml(data.track.size)}">${safeUrl}</res></item></DIDL-Lite>`;
            const safeMetadata = escapeXml(didl);

            // 1. Снова загружаем ссылку в плеер
            const setUriBody = `<?xml version="1.0" encoding="utf-8"?>
            <s:Envelope s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID><CurrentURI>${safeUrl}</CurrentURI><CurrentURIMetaData>${safeMetadata}</CurrentURIMetaData></u:SetAVTransportURI></s:Body></s:Envelope>`;

            await axios.post(RENDERER_URL, setUriBody, {
                headers: { 'Content-Type': 'text/xml; charset="utf-8"', 'SOAPAction': '"urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI"' }
            });

            console.log('[DLNA] 2. Буферизация 1 сек...');

            setTimeout(async () => {
                // 2. Делаем скрытую перемотку на сохраненное время
                console.log(`[DLNA] 3. Перемотка на ${data.time}...`);
                const seekBody = `<?xml version="1.0" encoding="utf-8"?>
                <s:Envelope s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:Seek xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>${data.time}</Target></u:Seek></s:Body></s:Envelope>`;

                try {
                    await axios.post(RENDERER_URL, seekBody, {
                        headers: { 'Content-Type': 'text/xml; charset="utf-8"', 'SOAPAction': '"urn:schemas-upnp-org:service:AVTransport:1#Seek"' }
                    });
                } catch (e) { console.error('[DLNA] Ошибка тихого Seek:', e.message); }

                // 3. Запускаем воспроизведение
                console.log('[DLNA] 4. Запуск PLAY!');
                sendDlnaTransport('Play', '<Speed>1</Speed>');
            }, 1000);

        } catch (err) {
            console.error('[DLNA Resume Ошибка]', err.message);
        }
    });

    // Навигация по папкам (остается без изменений)
    socket.on('dlna-browse', async (objectId) => {
        try {
            const data = await dlna.browse(objectId);
            socket.emit('dlna-data', { objectId, folders: data.folders, tracks: data.tracks });
        } catch (err) {
            console.error('[DLNA Ошибка Браузера]', err.message);
        }
    });

    // --- ДОБАВИТЬ ЭТОТ БЛОК ДЛЯ ТАЙМИНГА И ПЕРЕМОТКИ ---

    // Запрос текущего времени трека
    socket.on('request-time', async () => {
        const body = `<?xml version="1.0" encoding="utf-8"?>
        <s:Envelope s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
          <s:Body>
            <u:GetPositionInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
              <InstanceID>0</InstanceID>
            </u:GetPositionInfo>
          </s:Body>
        </s:Envelope>`;

        try {
            const res = await axios.post(RENDERER_URL, body, {
                headers: { 'Content-Type': 'text/xml; charset="utf-8"', 'SOAPAction': '"urn:schemas-upnp-org:service:AVTransport:1#GetPositionInfo"' }
            });

            // Простой парсинг XML регулярками для скорости
            const relTimeMatch = res.data.match(/<RelTime>(.*?)<\/RelTime>/);
            const trackDurMatch = res.data.match(/<TrackDuration>(.*?)<\/TrackDuration>/);

            if (relTimeMatch && trackDurMatch) {
                socket.emit('time-update', { current: relTimeMatch[1], total: trackDurMatch[1] });
            }
        } catch (e) {
            // Игнорируем ошибки при остановленном плеере
        }
    });

    // Команда перемотки
    socket.on('seek', async (targetTime) => {
        console.log(`[DLNA] Запрос перемотки на: ${targetTime}`);
        const body = `<?xml version="1.0" encoding="utf-8"?>
        <s:Envelope s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
          <s:Body>
            <u:Seek xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
              <InstanceID>0</InstanceID>
              <Unit>REL_TIME</Unit>
              <Target>${targetTime}</Target>
            </u:Seek>
          </s:Body>
        </s:Envelope>`;

        try {
            await axios.post(RENDERER_URL, body, {
                headers: { 'Content-Type': 'text/xml; charset="utf-8"', 'SOAPAction': '"urn:schemas-upnp-org:service:AVTransport:1#Seek"' }
            });
        } catch (e) {
            console.error('[DLNA Ошибка перемотки]', e.message);
        }
    });
    // --------------------------------------------------
    socket.on('disconnect', () => {
        console.log(`[WS] Отключен: ${socket.id}`);
        // Освобождаем сервер только если отключился именно текущий хозяин
        if (activeSocket && activeSocket.id === socket.id) {
            activeSocket = null;
            console.log(`[WS] Сервер свободен. Ждем новых подключений.`);
        }
    });
});

// Запуск сервера
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n==============================================`);
    console.log(`Бэкенд запущен! Порт: ${PORT}`);
    console.log(`==============================================\n`);
    pioneer.connect();
});