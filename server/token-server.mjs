import http from 'node:http';

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const apiKey = process.env.DEEPGRAM_API_KEY;

if (!apiKey) {
  console.error('Thiếu biến môi trường DEEPGRAM_API_KEY.');
  process.exit(1);
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type'
  });
  response.end(status === 204 ? undefined : JSON.stringify(data));
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {});
    return;
  }

  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || `${host}:${port}`}`);

  if (request.method === 'GET' && requestUrl.pathname === '/health') {
    sendJson(response, 200, { ok: true, service: 'saymee-live-token-server' });
    return;
  }

  if (request.method !== 'GET' || requestUrl.pathname !== '/token') {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  try {
    const deepgramResponse = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ttl_seconds: 60 })
    });

    const text = await deepgramResponse.text();
    if (!deepgramResponse.ok) {
      sendJson(response, deepgramResponse.status, {
        error: 'Deepgram token grant failed',
        detail: text
      });
      return;
    }

    const data = JSON.parse(text);
    sendJson(response, 200, {
      access_token: data.access_token,
      expires_in: data.expires_in
    });
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`Saymee token server: http://${host}:${port}/token`);
});
