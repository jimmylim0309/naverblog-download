const https = require('https');
const cheerio = require('cheerio');

// HTTP/HTTPS 요청 함수 (리다이렉션 자동 처리)
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

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { url } = JSON.parse(event.body || '{}');
    if (!url) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'URL이 필요합니다.' })
      };
    }

    // 모바일 URL 구조로 전환
    let targetUrl = url;
    if (url.includes('blog.naver.com') && !url.includes('m.blog.naver.com')) {
      targetUrl = url.replace('blog.naver.com', 'm.blog.naver.com');
    }

    const html = await fetchHtml(targetUrl);
    const $ = cheerio.load(html);

    // 1. 제목 추출 (og:title 또는 .se-title-text)
    let title = $('meta[property="og:title"]').attr('content') || $('.se-title-text').text() || $('title').text();
    title = title.replace(/[\\/:*?"<>|]/g, '').trim();

    // 2. 본문 텍스트 추출
    // 스마트에디터 ONE (.se-main-container / .se-component-text 등) 및 구버전 에디터 대응
    let textPieces = [];

    // 최신 스마트에디터 ONE 본문 요소들 선택
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
        if (text) {
          textPieces.push(text);
        }
      });
    });

    // 만약 위의 특정 클래스로 안 잡힐 경우 전체 se-main-container 내부 텍스트 수집
    if (textPieces.length === 0) {
      $('.se-main-container p, .se-main-container span').each((_, el) => {
        const text = $(el).text().trim();
        if (text && !textPieces.includes(text)) {
          textPieces.push(text);
        }
      });
    }

    // 최종 본문 조합 (중복 및 빈 줄 제거)
    const content = textPieces
      .join('\n')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');

    if (!content || content.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: '본문 텍스트를 추출하지 못했습니다. 링크가 비공개이거나 스마트에디터 형식이 아닐 수 있습니다.' })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title || 'blog_content',
        content: content
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ message: '서버 에러가 발생했습니다: ' + error.message })
    };
  }
};
