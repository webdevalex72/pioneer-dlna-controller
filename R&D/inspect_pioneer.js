const axios = require('axios');

const RENDERER_URL = 'http://192.168.1.129:8080/AVTransport/ctrl';

async function sendSoap(actionName, extraBody = '') {
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
        const res = await axios.post(RENDERER_URL, body, {
            headers: {
                'Content-Type': 'text/xml; charset="utf-8"',
                'SOAPAction': `"urn:schemas-upnp-org:service:AVTransport:1#${actionName}"`
            }
        });
        return res.data;
    } catch (e) {
        return `[ОШИБКА] ${e.response ? e.response.data : e.message}`;
    }
}

async function inspect() {
    console.log('================ ДИАГНОСТИКА ПЛЕЕРА ================');
    console.log('Ожидаем ответ от микропроцессора Pioneer...\n');

    // 1. Спрашиваем, какие команды сейчас разрешены
    const actionsStr = await sendSoap('GetCurrentTransportActions');
    const actionsMatch = actionsStr.match(/<Actions>(.*?)<\/Actions>/);
    console.log('1. РАЗРЕШЕННЫЕ КОМАНДЫ (Actions):');
    console.log(actionsMatch ? actionsMatch[1] : actionsStr);
    console.log('----------------------------------------------------');

    // 2. Спрашиваем текущее время (чтобы узнать точный формат)
    const timeStr = await sendSoap('GetPositionInfo');
    const relTimeMatch = timeStr.match(/<RelTime>(.*?)<\/RelTime>/);
    const trackDurMatch = timeStr.match(/<TrackDuration>(.*?)<\/TrackDuration>/);
    console.log('2. ФОРМАТ ВРЕМЕНИ ОТ ПЛЕЕРА:');
    console.log(`Текущее время: ${relTimeMatch ? relTimeMatch[1] : 'Не найдено'}`);
    console.log(`Длина трека:   ${trackDurMatch ? trackDurMatch[1] : 'Не найдено'}`);
    console.log('====================================================\n');
}

inspect();