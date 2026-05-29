const { Client } = require('node-ssdp');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');

const ssdpClient = new Client();
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

const PIONEER_IP = '192.168.1.129'; // Твой IP

console.log('Ищем UPnP сервисы Pioneer N-50A в локальной сети...');

ssdpClient.on('response', async (headers, statusCode, rinfo) => {
    // Фильтруем ответы, чтобы поймать только наш плеер
    if (rinfo.address === PIONEER_IP && headers.LOCATION) {
        console.log(`\n[1] Плеер найден! Файл описания: ${headers.LOCATION}`);
        ssdpClient.stop(); // Останавливаем поиск

        try {
            await explorePioneer(headers.LOCATION);
        } catch (error) {
            console.error('Ошибка при опросе плеера:', error.message);
        }
    }
});

// Запускаем поиск (ищем все MediaServer и MediaRenderer устройства)
ssdpClient.search('urn:schemas-upnp-org:device:MediaServer:1');

async function explorePioneer(locationUrl) {
    // 1. Скачиваем главный файл описания (description.xml)
    console.log('[2] Скачиваем структуру устройства...');
    const descResponse = await axios.get(locationUrl);
    const deviceObj = parser.parse(descResponse.data);

    // Получаем базовый URL (например, http://192.168.1.129:8080)
    const baseUrl = new URL(locationUrl).origin;

    // Ищем сервис ContentDirectory (он отвечает за меню и папки)
    let contentDirectoryUrl = null;
    const services = deviceObj.root.device.serviceList.service;

    // В зависимости от прошивки, сервисы могут быть массивом или объектом
    const serviceArray = Array.isArray(services) ? services : [services];

    for (const srv of serviceArray) {
        if (srv.serviceType.includes('ContentDirectory')) {
            contentDirectoryUrl = baseUrl + srv.controlURL;
            break;
        }
    }

    if (!contentDirectoryUrl) {
        return console.log('Сервис ContentDirectory не найден. Возможно, плеер выключен?');
    }

    console.log(`[3] URL для управления меню найден: ${contentDirectoryUrl}`);
    console.log('[4] Запрашиваем корневое меню (ID: 0)...\n');

    // 2. Формируем SOAP-запрос к ContentDirectory
    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
    <s:Envelope s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
      <s:Body>
        <u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
          <ObjectID>0</ObjectID>
          <BrowseFlag>BrowseDirectChildren</BrowseFlag>
          <Filter>*</Filter>
          <StartingIndex>0</StartingIndex>
          <RequestedCount>20</RequestedCount>
          <SortCriteria></SortCriteria>
        </u:Browse>
      </s:Body>
    </s:Envelope>`;

    // 3. Отправляем запрос на плеер
    const browseResponse = await axios.post(contentDirectoryUrl, soapBody, {
        headers: {
            'Content-Type': 'text/xml; charset="utf-8"',
            'SOAPACTION': '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"'
        }
    });

    // 4. Парсим ответ
    const responseObj = parser.parse(browseResponse.data);
    const browseResultXml = responseObj['s:Envelope']['s:Body']['u:BrowseResponse']['Result'];

    // Pioneer возвращает XML внутри XML, поэтому парсим результат еще раз
    const resultObj = parser.parse(browseResultXml);
    const containers = resultObj['DIDL-Lite']['container'];

    console.log('================ РЕЗУЛЬТАТ (КОРНЕВОЕ МЕНЮ) ================');
    const items = Array.isArray(containers) ? containers : [containers];
    items.forEach(item => {
        if (item) {
            console.log(`ID: ${item['@_id']} | Название: ${item['dc:title']}`);
        }
    });
    console.log('===========================================================');
}