const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');

// Указываем парсеру сохранять текстовые значения внутри тегов с атрибутами
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text"
});

const DLNA_URL = 'http://192.168.1.1:8200/ctl/ContentDir';

async function browseDlna(objectId) {
    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
    <s:Envelope s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
      <s:Body>
        <u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
          <ObjectID>${objectId}</ObjectID>
          <BrowseFlag>BrowseDirectChildren</BrowseFlag>
          <Filter>*</Filter>
          <StartingIndex>0</StartingIndex>
          <RequestedCount>50</RequestedCount>
          <SortCriteria></SortCriteria>
        </u:Browse>
      </s:Body>
    </s:Envelope>`;

    try {
        console.log(`Запрашиваем директорию [ID: ${objectId}]...`);
        const response = await axios.post(DLNA_URL, soapBody, {
            headers: {
                'Content-Type': 'text/xml; charset="utf-8"',
                'SOAPACTION': '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"'
            }
        });

        const responseObj = parser.parse(response.data);
        const browseResultXml = responseObj['s:Envelope']['s:Body']['u:BrowseResponse']['Result'];
        const resultObj = parser.parse(browseResultXml);

        const containers = resultObj['DIDL-Lite']['container'] || [];
        const items = resultObj['DIDL-Lite']['item'] || [];

        const arrContainers = Array.isArray(containers) ? containers : [containers];
        const arrItems = Array.isArray(items) ? items : [items];

        console.log('\n================ ПАПКИ ================');
        arrContainers.forEach(c => c && console.log(`[ID: ${c['@_id']}] 📁 ${c['dc:title']}`));

        console.log('\n================ ФАЙЛЫ ================');
        arrItems.forEach(i => {
            if (i) {
                // Достаем прямую ссылку на медиафайл
                let url = 'Ссылка не найдена';
                if (i.res) {
                    url = i.res['#text'] || i.res;
                }
                console.log(`[ID: ${i['@_id']}] 🎵 ${i['dc:title']}\n    🔗 ${url}`);
            }
        });
        console.log('=======================================');

    } catch (error) {
        console.error('Ошибка DLNA:', error.message);
    }
}

// Начинаем с папки Folders
browseDlna('1$14$0$5$3');