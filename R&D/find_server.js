const { Client } = require('node-ssdp');
const ssdpClient = new Client();

console.log('Ищем хранилища музыки (Media Servers) в твоей сети...');

ssdpClient.on('response', (headers, statusCode, rinfo) => {
    // Если устройство заявляет, что оно MediaServer
    if (headers.USN && headers.USN.includes('MediaServer')) {
        console.log(`\n[БИНГО!] Найден медиасервер по адресу: ${rinfo.address}`);
        console.log(`Ссылка на API: ${headers.LOCATION}`);
        console.log(`Имя устройства: ${headers.SERVER || 'Неизвестно'}\n`);
    }
});

// Ищем конкретно сервера
ssdpClient.search('urn:schemas-upnp-org:device:MediaServer:1');

setTimeout(() => {
    console.log('Поиск завершен.');
    process.exit(0);
}, 5000);