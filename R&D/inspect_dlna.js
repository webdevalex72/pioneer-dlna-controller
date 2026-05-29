const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text"
});

const DLNA_URL = 'http://192.168.1.1:8200/ctl/ContentDir';
const TEST_FOLDER_ID = '1$14$0$5$3'; // Папка Kari Bremnes

async function inspect() {
    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
    <s:Envelope s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
      <s:Body>
        <u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
          <ObjectID>${TEST_FOLDER_ID}</ObjectID>
          <BrowseFlag>BrowseDirectChildren</BrowseFlag>
          <Filter>*</Filter>
          <StartingIndex>0</StartingIndex>
          <RequestedCount>1</RequestedCount>
          <SortCriteria></SortCriteria>
        </u:Browse>
      </s:Body>
    </s:Envelope>`;

    try {
        console.log(`Отправляем запрос к Keenetic (Папка ID: ${TEST_FOLDER_ID})...`);
        const response = await axios.post(DLNA_URL, soapBody, {
            headers: {
                'Content-Type': 'text/xml; charset="utf-8"',
                'SOAPACTION': '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"'
            }
        });

        const responseObj = parser.parse(response.data);
        const browseResultXml = responseObj['s:Envelope']['s:Body']['u:BrowseResponse']['Result'];

        console.log('\n================ СЫРОЙ XML ОТВЕТ СЕРВЕРА ================');
        // Вытаскиваем чистый тег <item> без изменений
        const rawItemMatch = browseResultXml.match(/<item.*?>.*?<\/item>/s);
        if (rawItemMatch) {
            console.log(rawItemMatch[0]);
        } else {
            console.log('Тег <item> не найден! Возможно, ID папки изменился.');
        }

        console.log('\n================ РЕЗУЛЬТАТ ПАРСИНГА ================');
        const resultObj = parser.parse(browseResultXml);
        const item = resultObj['DIDL-Lite']['item'];
        const firstItem = Array.isArray(item) ? item[0] : item;

        console.log(JSON.stringify(firstItem, null, 2));

    } catch (error) {
        console.error('Ошибка:', error.message);
    }
}

inspect();