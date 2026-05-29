const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text"
});

const DLNA_URL = 'http://192.168.1.1:8200/ctl/ContentDir';

// ... верхняя часть файла с импортами остается ...

async function browse(objectId = '0') {
    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
    <s:Envelope s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
      <s:Body>
        <u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
          <ObjectID>${objectId}</ObjectID>
          <BrowseFlag>BrowseDirectChildren</BrowseFlag>
          <Filter>*</Filter>
          <StartingIndex>0</StartingIndex>
          <RequestedCount>100</RequestedCount>
          <SortCriteria></SortCriteria>
        </u:Browse>
      </s:Body>
    </s:Envelope>`;

    const response = await axios.post(DLNA_URL, soapBody, {
        headers: { 'Content-Type': 'text/xml; charset="utf-8"', 'SOAPACTION': '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"' }
    });

    const responseObj = parser.parse(response.data);
    const browseResultXml = responseObj['s:Envelope']['s:Body']['u:BrowseResponse']['Result'];
    const resultObj = parser.parse(browseResultXml);

    const containers = resultObj['DIDL-Lite']['container'] || [];
    const items = resultObj['DIDL-Lite']['item'] || [];

    const arrContainers = Array.isArray(containers) ? containers : [containers];
    const arrItems = Array.isArray(items) ? items : [items];

    const folders = arrContainers.filter(c => c).map(c => ({
        id: c['@_id'],
        title: c['dc:title']
    }));

    const tracks = arrItems.filter(i => i).map(i => {
        let url = i.res ? (i.res['#text'] || i.res) : '';

        // Максимально защищенный парсинг обложки
        let cover = null;
        if (i['upnp:albumArtURI']) {
            const artObj = Array.isArray(i['upnp:albumArtURI']) ? i['upnp:albumArtURI'][0] : i['upnp:albumArtURI'];

            if (typeof artObj === 'string') {
                cover = artObj;
            } else if (artObj && artObj['#text']) {
                cover = artObj['#text'];
            }

            // На случай относительных путей
            if (cover && typeof cover === 'string' && !cover.startsWith('http')) {
                cover = `http://192.168.1.1:8200${cover.startsWith('/') ? '' : '/'}${cover}`;
            }
        }

        const artist = i['upnp:artist'] ? (i['upnp:artist']['#text'] || i['upnp:artist']) : 'Неизвестный исполнитель';
        const album = i['upnp:album'] ? (i['upnp:album']['#text'] || i['upnp:album']) : 'Неизвестный альбом';

        // ДОБАВЛЯЕМ ИЗВЛЕЧЕНИЕ ТЕХНИЧЕСКИХ ДАННЫХ ДЛЯ ПИОНЕРА
        const duration = i.res ? i.res['@_duration'] : '';
        const protocolInfo = i.res ? i.res['@_protocolInfo'] : '';
        const size = i.res ? i.res['@_size'] : '';

        return {
            id: i['@_id'],
            title: i['dc:title'],
            url: url,
            artist: artist,
            album: album,
            cover: cover,
            duration: duration || '',
            protocolInfo: protocolInfo || '',
            size: size || ''
        };
    });

    // --- ШПИОН ДЛЯ КОНСОЛИ ---
    // Выводим данные первого трека прямо в терминал сервера
    if (tracks.length > 0) {
        console.log(`\n[DEBUG DLNA] Папка распарсена. Проверка первого трека:`);
        console.log(`🎵 Название: ${tracks[0].title}`);
        console.log(`🖼 Обложка:  ${tracks[0].cover || 'ПУСТО (null)'}\n`);
    }

    return { folders, tracks };
}

module.exports = { browse };
