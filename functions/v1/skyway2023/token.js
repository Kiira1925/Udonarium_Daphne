const encoder = new TextEncoder();

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  const env = context.env;
  const skyWayAppId = env.SKYWAY_APP_ID || '';
  const skyWaySecretKey = env.SKYWAY_SECRET_KEY || env.SKYWAY_SECRET || '';

  if (!skyWayAppId || !skyWaySecretKey) {
    return jsonResponse(503, {
      error: 'skyway_not_configured',
      message: 'Set SKYWAY_APP_ID and SKYWAY_SECRET_KEY in Cloudflare Pages environment variables.',
    });
  }

  let body;
  try {
    body = await context.request.json();
  } catch (error) {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  const channelName = `${body.channelName || ''}`;
  const peerId = `${body.peerId || ''}`;
  if (!isValidSkyWayName(channelName) || !isValidSkyWayName(peerId) || channelName.startsWith('udonarium-lobby-')) {
    return jsonResponse(400, { error: 'invalid_request' });
  }

  const token = await createSkyWayAuthToken(env, channelName, peerId);
  return jsonResponse(200, { token });
}

function isValidSkyWayName(name) {
  return 0 < name.length && !name.includes('*') && name.length <= 255;
}

async function createSkyWayAuthToken(env, channelName, peerId) {
  const skyWayAppId = env.SKYWAY_APP_ID || '';
  const skyWaySecretKey = env.SKYWAY_SECRET_KEY || env.SKYWAY_SECRET || '';
  const ttlSec = Number(env.SKYWAY_TOKEN_TTL_SEC || 60 * 60 * 24);
  const lobbySize = Number(env.SKYWAY_LOBBY_SIZE || 4);
  const now = Math.floor(Date.now() / 1000);
  const isPrivateRoom = channelName === peerId;

  const payload = {
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + ttlSec,
    scope: {
      app: {
        id: skyWayAppId,
        turn: false,
        actions: ['read'],
        channels: [
          {
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
          },
          {
            name: `udonarium-lobby-*-of-${lobbySize}`,
            actions: ['read', 'create'],
            members: [
              {
                name: peerId,
                actions: ['write'],
              },
            ],
          },
        ],
      },
    },
    version: 2,
  };

  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };
  const unsignedToken = `${base64UrlEncodeJson(header)}.${base64UrlEncodeJson(payload)}`;
  const signature = await hmacSha256Base64Url(skyWaySecretKey, unsignedToken);
  return `${unsignedToken}.${signature}`;
}

async function hmacSha256Base64Url(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

function base64UrlEncodeJson(value) {
  return base64UrlEncodeBytes(encoder.encode(JSON.stringify(value)));
}

function base64UrlEncodeBytes(bytes) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function jsonResponse(status, body) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
