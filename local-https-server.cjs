const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { SkyWayAuthToken, nowInSec, uuidV4 } = require('@skyway-sdk/token');

const root = path.join(__dirname, 'dist', 'udonarium-daphne');
const certPath = path.join(__dirname, 'node_modules', '.cache', 'webpack-dev-server', 'server.pem');
const logPath = path.join(__dirname, 'local-https-server.log');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4200);
const protocol = (process.env.PROTOCOL || process.env.SERVER_PROTOCOL || 'https').toLowerCase();
const skyWayAppId = process.env.SKYWAY_APP_ID || '';
const skyWaySecretKey = process.env.SKYWAY_SECRET_KEY || process.env.SKYWAY_SECRET || '';
const skyWayTokenTtlSec = Number(process.env.SKYWAY_TOKEN_TTL_SEC || 60 * 60 * 24);
const skyWayLobbySize = Number(process.env.SKYWAY_LOBBY_SIZE || 4);

const mime = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
};

function log(message) {
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
}

process.on('uncaughtException', (error) => {
  log(error.stack || String(error));
  process.exit(1);
});

const requestHandler = (request, response) => {
  if (request.url === '/v1/status') {
    responseJson(response, 200, { ok: true, skyway: skyWayIsConfigured() });
    return;
  }

  if (request.url === '/v1/skyway2023/token') {
    handleSkyWayTokenRequest(request, response);
    return;
  }

  const pathname = decodeURIComponent(new URL(request.url, 'https://127.0.0.1').pathname);
  let file = path.normalize(path.join(root, pathname));

  if (!file.startsWith(path.normalize(root))) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    file = path.join(file, 'index.html');
  }

  if (!fs.existsSync(file)) {
    file = path.join(root, 'index.html');
  }

  response.writeHead(200, {
    'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
  });
  fs.createReadStream(file).pipe(response);
};

const server = protocol === 'http'
  ? http.createServer(requestHandler)
  : https.createServer({ key: fs.readFileSync(certPath), cert: fs.readFileSync(certPath) }, requestHandler);

function skyWayIsConfigured() {
  return 0 < skyWayAppId.length && 0 < skyWaySecretKey.length;
}

function responseJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function handleSkyWayTokenRequest(request, response) {
  if (request.method !== 'POST') {
    responseJson(response, 405, { error: 'method_not_allowed' });
    return;
  }

  if (!skyWayIsConfigured()) {
    responseJson(response, 503, {
      error: 'skyway_not_configured',
      message: 'Set SKYWAY_APP_ID and SKYWAY_SECRET_KEY before starting the server.',
    });
    return;
  }

  readJsonBody(request)
    .then((body) => {
      const channelName = `${body.channelName || ''}`;
      const peerId = `${body.peerId || ''}`;
      if (!isValidSkyWayName(channelName) || !isValidSkyWayName(peerId) || channelName.startsWith('udonarium-lobby-')) {
        responseJson(response, 400, { error: 'invalid_request' });
        return;
      }

      const token = createSkyWayAuthToken(channelName, peerId);
      responseJson(response, 200, { token });
    })
    .catch((error) => {
      log(error.stack || String(error));
      responseJson(response, 400, { error: 'invalid_json' });
    });
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
      if (1024 * 16 < raw.length) {
        reject(new Error('Request body too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function isValidSkyWayName(name) {
  return 0 < name.length && !name.includes('*') && name.length <= 255;
}

function createSkyWayAuthToken(channelName, peerId) {
  const channelMap = new Map();
  const isPrivateRoom = channelName === peerId;

  channelMap.set(channelName, {
    name: channelName,
    actions: isPrivateRoom ? ['read', 'create', 'updateMetadata'] : ['read', 'create'],
    members: [
      {
        name: peerId,
        actions: ['write'],
        publication: {
          actions: ['write'],
        },
        subscription: {
          actions: ['write'],
        },
      },
      {
        name: '*',
        actions: ['signal'],
      },
    ],
  });

  const lobbyName = `udonarium-lobby-*-of-${skyWayLobbySize}`;
  channelMap.set(lobbyName, {
    name: lobbyName,
    actions: ['read', 'create'],
    members: [
      {
        name: peerId,
        actions: ['write'],
      },
    ],
  });

  const token = new SkyWayAuthToken({
    jti: uuidV4(),
    iat: nowInSec(),
    exp: nowInSec() + skyWayTokenTtlSec,
    scope: {
      app: {
        id: skyWayAppId,
        turn: false,
        actions: ['read'],
        channels: Array.from(channelMap.values()),
      },
    },
    version: 2,
  });

  return token.encode(skyWaySecretKey);
}

server.on('error', (error) => {
  log(error.stack || String(error));
  process.exit(1);
});

server.listen(port, host, () => {
  const urls = host === '0.0.0.0'
    ? Object.values(os.networkInterfaces())
      .flat()
      .filter((address) => address && address.family === 'IPv4' && !address.internal)
      .map((address) => `${protocol}://${address.address}:${port}/`)
    : [`${protocol}://${host}:${port}/`];

  log(`Listening on ${protocol}://${host}:${port}`);
  console.log(urls.join('\n'));
});
