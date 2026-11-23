// Pipeline behaviour every endpoint shares: headers, CORS, origin check, view-as guard, 404, body parsing.
export default [
  {
    name: 'health and 404s',
    steps: [
      { path: '/api/health' },
      { method: 'HEAD', path: '/api/health' },
      { path: '/api/nope' },
      { method: 'POST', path: '/api/nope' },
      { method: 'HEAD', path: '/api/nope' },
      { path: '/api/nope?x=<b>' },
      { path: '/api/Auth/Session/' },
      { path: '/files/public/../secret' },
      { path: '/files/public/logos/does-not-exist.png' },
    ],
  },
  {
    name: 'cors and guards',
    steps: [
      { method: 'OPTIONS', path: '/api/auth/login', headers: { origin: 'http://evil', 'access-control-request-headers': 'content-type' } },
      { method: 'OPTIONS', path: '/api/whatever' },
      { method: 'POST', path: '/api/auth/logout', headers: { origin: 'http://evil' } },
      { method: 'POST', path: '/api/auth/logout', headers: { origin: 'http://localhost:5273' } },
      { method: 'POST', path: '/api/auth/logout', headers: { 'x-admin-view-as': '1' } },
      { path: '/api/auth/session', headers: { 'x-admin-view-as': '1' } },
    ],
  },
  {
    name: 'body parsing',
    steps: [
      { method: 'POST', path: '/api/auth/login', raw: '{bad json', headers: { 'content-type': 'application/json' } },
      { method: 'POST', path: '/api/auth/login', raw: '"a string"', headers: { 'content-type': 'application/json' } },
      { method: 'POST', path: '/api/auth/login', raw: '[1,2]', headers: { 'content-type': 'application/json' } },
      { method: 'POST', path: '/api/auth/login', raw: 'email=a', headers: { 'content-type': 'application/x-www-form-urlencoded' } },
      { method: 'POST', path: '/api/auth/login', raw: '{"email":1}', headers: { 'content-type': 'application/vnd.api+json' } },
      { method: 'POST', path: '/api/auth/login', raw: '{"a":"' + 'x'.repeat(110000) + '"}', headers: { 'content-type': 'application/json' } },
      { method: 'POST', path: '/api/auth/login', body: {} },
    ],
  },
  {
    name: 'etag revalidation',
    steps: [
      { path: '/api/auth/session', headers: { 'if-none-match': 'W/"4f-gwyrAlaTwiwH2HzCE9QD0ruQpRg"' } },
      { path: '/api/auth/session', headers: { 'if-none-match': 'W/"4f-gwyrAlaTwiwH2HzCE9QD0ruQpRg"', 'cache-control': 'no-cache' } },
      { path: '/api/auth/session', headers: { 'if-none-match': '"other"' } },
    ],
  },
]
