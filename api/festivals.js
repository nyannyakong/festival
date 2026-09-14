const FESTIVAL_API_URL = 'https://apis.data.go.kr/B551011/KorService2/searchFestival2';
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

function sendJson(response, status, body) {
  response.status(status).json(body);
}

function normalizeServiceKey(value) {
  if (!value) return '';

  try {
    // 공공데이터포털에서 복사한 URL 인코딩 키를 한 번만 원래 값으로 되돌립니다.
    return decodeURIComponent(value);
  } catch {
    // 이미 디코딩되었거나 잘못된 % 문자가 있으면 원본을 그대로 사용합니다.
    return value;
  }
}

function isDate(value) {
  if (!/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function asItems(data) {
  const item = data?.response?.body?.items?.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

function readApiMessage(text) {
  const match = text.match(/<errMsg>([^<]+)<\/errMsg>|<returnAuthMsg>([^<]+)<\/returnAuthMsg>/i);
  return match ? (match[1] || match[2]).trim() : '';
}

function formatFestival(item) {
  const address = [item.addr1, item.addr2].filter(Boolean).join(' ').trim();
  return {
    title: item.title || '제목 정보 없음',
    address: address || '주소 정보 없음',
    startDate: item.eventstartdate || '',
    endDate: item.eventenddate || '',
    image: item.firstimage || item.firstimage2 || '',
  };
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return sendJson(response, 405, { error: 'GET 요청만 사용할 수 있습니다.' });
  }

  const serviceKey = normalizeServiceKey(process.env.DATA_GO_KR_API_KEY);
  if (!serviceKey) {
    return sendJson(response, 500, { error: '서버의 공공데이터 인증키가 설정되지 않았습니다.' });
  }

  const region = typeof request.query.region === 'string' ? request.query.region : '';
  const startDate = typeof request.query.startDate === 'string' ? request.query.startDate : '';
  const endDate = typeof request.query.endDate === 'string' ? request.query.endDate : '';
  const keyword = typeof request.query.keyword === 'string' ? request.query.keyword.trim() : '';

  if (!isDate(startDate) || !isDate(endDate)) {
    return sendJson(response, 400, { error: '시작일과 종료일을 YYYYMMDD 형식으로 입력하세요.' });
  }
  if (startDate > endDate) {
    return sendJson(response, 400, { error: '종료일은 시작일보다 빠를 수 없습니다.' });
  }
  if (region && !/^\d{2}$/.test(region)) {
    return sendJson(response, 400, { error: '지역 코드 형식이 올바르지 않습니다.' });
  }
  if (keyword.length > 100) {
    return sendJson(response, 400, { error: '키워드는 100자 이하로 입력하세요.' });
  }

  try {
    const festivals = [];
    let totalCount = 0;

    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo += 1) {
      const params = new URLSearchParams({
        serviceKey,
        MobileOS: 'ETC',
        MobileApp: 'festival-search',
        _type: 'json',
        eventStartDate: startDate,
        eventEndDate: endDate,
        numOfRows: String(PAGE_SIZE),
        pageNo: String(pageNo),
      });
      if (region) params.set('lDongRegnCd', region);

      const upstreamResponse = await fetch(`${FESTIVAL_API_URL}?${params.toString()}`);
      const responseText = await upstreamResponse.text();
      let data;

      try {
        data = JSON.parse(responseText);
      } catch {
        const apiMessage = readApiMessage(responseText);
        throw new Error(apiMessage ? `UPSTREAM:${apiMessage}` : 'UPSTREAM:invalid-response');
      }

      if (!upstreamResponse.ok || data?.response?.header?.resultCode !== '0000') {
        throw new Error('UPSTREAM:request-failed');
      }

      const items = asItems(data);
      festivals.push(...items.map(formatFestival));
      totalCount = Number(data?.response?.body?.totalCount || 0);

      if (!items.length || festivals.length >= totalCount) break;
    }

    const normalizedKeyword = keyword.toLocaleLowerCase('ko-KR');
    const results = festivals.filter((festival) => !normalizedKeyword || `${festival.title} ${festival.address}`.toLocaleLowerCase('ko-KR').includes(normalizedKeyword));
    return sendJson(response, 200, {
      festivals: results,
      totalCount,
      fetchedCount: festivals.length,
      partial: festivals.length < totalCount,
    });
  } catch (error) {
    console.error('Festival API request failed:', error.message);
    return sendJson(response, 502, { error: '행사 정보를 불러오지 못했습니다. 잠시 후 다시 시도하세요.' });
  }
};
