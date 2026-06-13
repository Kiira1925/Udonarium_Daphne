export function onRequest(context) {
  if (context.request.method !== 'GET') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  const appId = context.env.SKYWAY_APP_ID || '';
  const secret = context.env.SKYWAY_SECRET_KEY || context.env.SKYWAY_SECRET || '';
  return jsonResponse(200, {
    ok: true,
    skyway: 0 < appId.length && 0 < secret.length,
  });
}

function jsonResponse(status, body) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
