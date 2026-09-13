const https = require('https');
const cheerio = require('cheerio');
const JSZip = require('jszip');

// HTTP/HTTPS 요청 함수 (리다이렉션 처리 포함)
function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          redirectUrl = 'https://m.blog.naver.com' + redirectUrl;
        }
        return fetchHtml(redirectUrl).then(resolve).catch(reject);
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', err => reject(err));
  });
}

// 블로그 단일 개체 파싱 함수
async function parseSingleBlog(url, index) {
  try {
    let targetUrl = url.trim();
    if (!targetUrl) return null;

    if (targetUrl.includes('blog.naver.com') && !targetUrl.includes('m.blog.naver.com')) {
      targetUrl = targetUrl.replace('blog.naver.com', 'm.blog.naver.com');
    }

    const html = await fetchHtml(targetUrl);
    const $ = cheerio.load(html);

    // 제목 추출
    let title = $('meta[property="og:title"]').attr('content') || $('.se-title-text').text() || $('title').text();
    title = title.replace(/[\\/:*?"<>|]/g, '').trim();
    if (!title) title = `blog_content_${index + 1}`;

    // 본문 추출
    let textPieces = [];
    const textSelectors = [
      '.se-component-text',
      '.se-text-paragraph',
      '.se-module-text',
      '.post_area',
      '#post-view-zone'
    ];

    textSelectors.forEach(selector => {
      $(selector).each((_, el) => {
        const text = $(el).text().trim();
        if (text) textPieces.push(text);
      });
    });

    if (textPieces.length === 0) {
      $('.se-main-container p, .se-main-container span').each((_, el) => {
        const text = $(el).text().trim();
        if (text && !textPieces.includes(text)) textPieces.push(text);
      });
    }

    const content = textPieces
      .join('\n')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');

    if (!content) return null;

    return { title, content };
  } catch (error) {
    console.error(`Error parsing ${url}:`, error);
    return null;
  }
}

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { urls } = JSON.parse(event.body || '{}');

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: '하나 이상의 올바른 URL을 입력해야 합니다.' })
      };
    }

    // 최대 20개 URL 제한 (서버리스 함수 타임아웃 방지)
    const targetUrls = urls.slice(0, 20);
    const results = await Promise.all(targetUrls.map((url, idx) => parseSingleBlog(url, idx)));
    const validResults = results.filter(item => item !== null);

    if (validResults.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: '입력한 URL에서 본문 텍스트를 추출하지 못했습니다.' })
      };
    }

    // JSZip 객체 생성 및 파일 추가
    const zip = new JSZip();
    const usedTitles = new Set();

    validResults.forEach((item, idx) => {
      let fileName = item.title;
      // 파일명 중복 처리
      if (usedTitles.has(fileName)) {
        fileName = `${fileName}_${idx + 1}`;
      }
      usedTitles.add(fileName);

      zip.file(`${fileName}.txt`, item.content);
    });

    // ZIP 파일 생성 (Base64 인코딩)
    const zipBase64 = await zip.generateAsync({ type: 'base64' });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        zipData: zipBase64,
        count: validResults.length
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ message: '서버 에러가 발생했습니다: ' + error.message })
    };
  }
};
