const https = require('https');

// URL에서 HTML을 가져오는 함수 (리다이렉트 자동 추적 포함)
function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, (res) => {
      // 리다이렉트(301, 302) 처리
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchHtml(res.headers.location).then(resolve).catch(reject);
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', err => reject(err));
  });
}

// HTML 태그 제거 및 본문 텍스트 추출 함수
function parseBlogContent(html) {
  let mainContent = html;

  // 1. 블로그 제목 추출 시도
  let title = 'blog_content';
  const titleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/i) || 
                     html.match(/<title>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    title = titleMatch[1].replace(/[\\/:*?"<>|]/g, '').trim(); // 파일명으로 쓸 수 없는 특수문자 제거
  }

  // 2. 모바일/스마트에디터 본문 컨테이너 추출
  const containerMatches = [
    html.match(/<div[^>]*class="[^"]*se-main-container[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i),
    html.match(/<div[^>]*id="post-view-zone"[^>]*>([\s\S]*?)<\/div>/i),
    html.match(/<div[^>]*class="[^"]*post_area[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
  ];

  for (const match of containerMatches) {
    if (match && match[1]) {
      mainContent = match[1];
      break;
    }
  }

  // 3. 스크립트, 스타일 태그 완전히 제거
  mainContent = mainContent.replace(/<script[\s\S]*?<\/script>/gi, '')
                           .replace(/<style[\s\S]*?<\/style>/gi, '')
                           .replace(/<!--[\s\S]*?-->/g, '');

  // 4. 단락 구분 및 줄바꿈 태그 처리
  mainContent = mainContent.replace(/<\/p>/gi, '\n')
                           .replace(/<\/div>/gi, '\n')
                           .replace(/<br\s*[\/]?>/gi, '\n')
                           .replace(/<\/li>/gi, '\n');

  // 5. HTML 태그 제거
  let cleanText = mainContent.replace(/<[^>]+>/g, '');

  // 6. HTML 엔티티 디코딩
  cleanText = cleanText.replace(/&nbsp;/gi, ' ')
                       .replace(/&lt;/gi, '<')
                       .replace(/&gt;/gi, '>')
                       .replace(/&amp;/gi, '&')
                       .replace(/&quot;/gi, '"')
                       .replace(/&#39;/gi, "'");

  // 7. 다중 공백 및 빈 줄 정돈
  const lines = cleanText.split('\n')
                         .map(line => line.trim())
                         .filter(line => line.length > 0);

  return {
    title: title,
    content: lines.join('\n')
  };
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

    // 네이버 블로그 URL을 모바일 URL 구조로 변환
    let targetUrl = url;
    if (url.includes('blog.naver.com') && !url.includes('m.blog.naver.com')) {
      targetUrl = url.replace('blog.naver.com', 'm.blog.naver.com');
    }

    const html = await fetchHtml(targetUrl);
    const result = parseBlogContent(html);

    if (!result.content || result.content.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: '본문 텍스트를 추출하지 못했습니다. URL을 확인해 주세요.' })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: result.title,
        content: result.content
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ message: '서버 에러가 발생했습니다: ' + error.message })
    };
  }
};
