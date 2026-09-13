const https = require('https');

// URL에서 HTML을 가져오는 함수
function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', err => reject(err));
  });
}

// HTML 태그 제거 및 텍스트 추출 함수
function parseBlogContent(html) {
  // 모바일 웹 기준 본문 영역 추출 (.se-main-container)
  let mainContent = html;
  const containerMatch = html.match(/<div[^>]*class="[^"]*se-main-container[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i);
  if (containerMatch) {
    mainContent = containerMatch[1];
  }

  // 스크립트, 스타일 태그 제거
  mainContent = mainContent.replace(/<script[\s\S]*?<\/script>/gi, '')
                           .replace(/<style[\s\S]*?<\/style>/gi, '');

  // P 태그 및 BR 태그를 줄바꿈으로 변환
  mainContent = mainContent.replace(/<\/p>/gi, '\n')
                           .replace(/<br\s*[\/]?>/gi, '\n');

  // 모든 HTML 태그 제거
  let cleanText = mainContent.replace(/<[^>]+>/g, '');

  // 특수문자 디코딩
  cleanText = cleanText.replace(/&nbsp;/g, ' ')
                       .replace(/&lt;/g, '<')
                       .replace(/&gt;/g, '>')
                       .replace(/&amp;/g, '&')
                       .replace(/&quot;/g, '"');

  // 연속된 빈 줄 정리
  return cleanText.split('\n').map(line => line.trim()).filter(line => line.length > 0).join('\n');
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

    // 네이버 블로그 URL을 모바일 URL 구조로 변환 (파싱 용이)
    let targetUrl = url;
    if (url.includes('blog.naver.com') && !url.includes('m.blog.naver.com')) {
      targetUrl = url.replace('blog.naver.com', 'm.blog.naver.com');
    }

    const html = await fetchHtml(targetUrl);
    const content = parseBlogContent(html);

    if (!content || content.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: '본문 텍스트를 추출하지 못했습니다. URL을 확인해 주세요.' })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'blog_content',
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
