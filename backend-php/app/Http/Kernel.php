<?php

declare(strict_types=1);

namespace App\Http;

use App\Auth\SessionScope;
use App\Core\Env;
use Symfony\Component\HttpFoundation\Request as SymfonyRequest;
use Symfony\Component\HttpFoundation\Response;

/**
 * The Express app pipeline of server/src/app.ts, in the same order:
 * helmet -> cors -> (compression: nginx) -> cookie-parser -> express.json -> origin check ->
 * view-as guard -> app routes -> mounted routers (in mount order) -> finalhandler 404 / errorHandler.
 *
 * Laravel's HTTP kernel, sessions and middleware are bypassed on purpose: they would add
 * cookies, headers and redirects the Node backend never sent.
 */
final class Kernel
{
    private const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

    public const HELMET_CSP = "default-src 'none';img-src 'self';object-src 'none';frame-ancestors 'none';base-uri 'self';"
        . "font-src 'self' https: data:;form-action 'self';script-src 'self';script-src-attr 'none';"
        . "style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests";

    /** helmet 7 defaults plus app.ts's overrides, in helmet's order. */
    private const HELMET = [
        'Content-Security-Policy' => self::HELMET_CSP,
        'Cross-Origin-Opener-Policy' => 'same-origin',
        'Cross-Origin-Resource-Policy' => 'cross-origin',
        'Origin-Agent-Cluster' => '?1',
        'Referrer-Policy' => 'no-referrer',
        'Strict-Transport-Security' => 'max-age=15552000; includeSubDomains',
        'X-Content-Type-Options' => 'nosniff',
        'X-DNS-Prefetch-Control' => 'off',
        'X-Download-Options' => 'noopen',
        'X-Frame-Options' => 'SAMEORIGIN',
        'X-Permitted-Cross-Domain-Policies' => 'none',
        'X-XSS-Protection' => '0',
    ];

    public function __construct(private readonly Routes $routes)
    {
    }

    public function handle(SymfonyRequest $sr): Output
    {
        SessionScope::clear();
        CookieJar::drain();
        $method = strtoupper($sr->getMethod());
        $req = null;
        try {
            if ($method === 'OPTIONS') {
                return $this->finish($sr, null, $this->preflight($sr), isPreflight: true);
            }
            $req = Req::fromSymfony($sr, self::clientIp($sr));
            $response = $this->dispatch($req);
        } catch (\Throwable $e) {
            $response = ErrorHandler::render($e);
        }
        $out = $this->finish($sr, $req, $response);
        SessionScope::clear();
        return $out;
    }

    private function dispatch(Req $req): Response
    {
        if (!in_array($req->method, self::SAFE_METHODS, true)) {
            $origin = $req->header('origin');
            if ($origin !== null && $origin !== '' && $origin !== Env::get('CLIENT_ORIGIN')) {
                return Res::json(['error' => ['message' => 'Cross-origin request blocked.']], 403);
            }
            $viewAs = $req->header('x-admin-view-as');
            if ($viewAs !== null && $viewAs !== '') {
                return Res::json(['error' => ['message' => 'This is a read-only admin view. Sign in as the convenor to make changes.']], 403);
            }
        }

        foreach ($this->routes->mounts() as [$prefix, $middleware, $router]) {
            $sub = self::stripPrefix($prefix, $req->path);
            if ($sub === null) {
                continue;
            }
            $match = $router->match($req->method, $sub);
            if ($match === null && $middleware === []) {
                continue;
            }
            $stack = $middleware;
            if ($match !== null) {
                $req->params = $match['params'];
                $stack = [...$middleware, ...$match['stack']];
            } else {
                // Mount-level middleware (rate limit) runs even when no route matches, then Express moves on.
                $stack[] = static fn (Req $r) => null;
            }
            $response = self::runStack($stack, $req);
            if ($response !== null) {
                return $response;
            }
        }
        return ErrorHandler::notFound($req->method, $req->originalUrl);
    }

    /** @param list<callable> $stack middleware fn(Req, next) and a final handler fn(Req) */
    private static function runStack(array $stack, Req $req): ?Response
    {
        $run = static function (int $i, Req $r) use (&$run, $stack): ?Response {
            $fn = $stack[$i];
            if ($i === count($stack) - 1) {
                return $fn($r);
            }
            return $fn($r, static fn (Req $next) => $run($i + 1, $next));
        };
        return $run(0, $req);
    }

    /** app.use(prefix): case-insensitive, whole segments; returns the path the router sees. */
    private static function stripPrefix(string $prefix, string $path): ?string
    {
        if ($prefix === '' || $prefix === '/') {
            return $path;
        }
        $len = strlen($prefix);
        if (strncasecmp($path, $prefix, $len) !== 0) {
            return null;
        }
        $rest = substr($path, $len);
        if ($rest === '' || $rest === false) {
            return '/';
        }
        if ($rest[0] !== '/') {
            return null;
        }
        return $rest;
    }

    private function preflight(SymfonyRequest $sr): Response
    {
        $headers = [
            'Access-Control-Allow-Methods' => 'GET,HEAD,PUT,PATCH,POST,DELETE',
        ];
        $requested = $sr->headers->get('access-control-request-headers');
        if ($requested !== null && $requested !== '') {
            $headers['Access-Control-Allow-Headers'] = $requested;
        }
        return new Response('', 204, $headers + ['Content-Length' => '0']);
    }

    /** Headers every response carries, ETag / 304, HEAD body stripping, queued cookies. */
    private function finish(SymfonyRequest $sr, ?Req $req, Response $response, bool $isPreflight = false): Output
    {
        $h = $response->headers;
        foreach (self::HELMET as $name => $value) {
            if (!$h->has($name)) {
                $h->set($name, $value);
            }
        }
        $h->set('Access-Control-Allow-Origin', (string) Env::get('CLIENT_ORIGIN'));
        $h->set('Access-Control-Allow-Credentials', 'true');
        $vary = $isPreflight ? ['Origin', 'Access-Control-Request-Headers'] : ['Origin', 'Accept-Encoding'];
        $existing = array_filter(array_map('trim', explode(',', (string) $h->get('Vary', ''))));
        $h->set('Vary', implode(', ', array_values(array_unique([...$vary, ...$existing]))));
        foreach ($req?->locals['rateLimitHeaders'] ?? [] as $name => $value) {
            if (!$h->has($name)) {
                $h->set($name, $value);
            }
        }
        $cookies = CookieJar::drain();

        $method = strtoupper($sr->getMethod());
        if ($h->has(Res::SENT_HEADER)) {
            $h->remove(Res::SENT_HEADER);
            $body = (string) $response->getContent();
            $h->set('Content-Length', (string) strlen($body));
            if (!$h->has('ETag')) {
                $h->set('ETag', self::etag($body));
            }
            if (self::isFresh($sr, $response)) {
                $response->setStatusCode(304);
            }
        }
        $status = $response->getStatusCode();
        if ($status === 204 || $status === 304) {
            $h->remove('Content-Type');
            $h->remove('Transfer-Encoding');
            if ($status === 304) {
                $h->remove('Content-Length');
            }
            $response->setContent('');
        }
        $isStream = $response instanceof \Symfony\Component\HttpFoundation\StreamedResponse;
        if (!$isStream && $status !== 204 && $status !== 304 && !$h->has('Content-Length')) {
            $h->set('Content-Length', (string) strlen((string) $response->getContent()));
        }
        $withBody = $method !== 'HEAD' && $status !== 204 && $status !== 304;

        $lines = [];
        foreach ($h->allPreserveCaseWithoutCookies() as $name => $values) {
            if (strcasecmp($name, 'Cache-Control') === 0) {
                continue;
            }
            foreach ($values as $v) {
                $lines[] = [$name, (string) $v];
            }
        }
        $cacheControl = Res::rawCacheControl($response);
        if ($cacheControl !== null) {
            $lines[] = ['Cache-Control', $cacheControl];
        }
        foreach ($cookies as $cookie) {
            $lines[] = ['Set-Cookie', $cookie];
        }
        return new Output($status, $lines, $response, $withBody);
    }

    /** The `etag` package (weak): W/"<len hex>-<base64 sha1, 27 chars>" */
    public static function etag(string $body): string
    {
        $hash = substr(base64_encode(sha1($body, true)), 0, 27);
        return 'W/"' . dechex(strlen($body)) . '-' . $hash . '"';
    }

    /** Express req.fresh (the `fresh` package) for GET/HEAD with a 2xx/304 status. */
    private static function isFresh(SymfonyRequest $sr, Response $response): bool
    {
        $method = strtoupper($sr->getMethod());
        $status = $response->getStatusCode();
        if (($method !== 'GET' && $method !== 'HEAD') || !(($status >= 200 && $status < 300) || $status === 304)) {
            return false;
        }
        $noneMatch = $sr->headers->get('if-none-match');
        $modifiedSince = $sr->headers->get('if-modified-since');
        if (($noneMatch === null || $noneMatch === '') && ($modifiedSince === null || $modifiedSince === '')) {
            return false;
        }
        $cacheControl = (string) $sr->headers->get('cache-control', '');
        if ($cacheControl !== '' && preg_match('/(?:^|,)\s*?no-cache\s*?(?:,|$)/', $cacheControl)) {
            return false;
        }
        if ($noneMatch !== null && $noneMatch !== '' && $noneMatch !== '*') {
            $etag = (string) $response->headers->get('ETag', '');
            if ($etag === '') {
                return false;
            }
            $matches = false;
            foreach (array_map('trim', explode(',', $noneMatch)) as $match) {
                if ($match === $etag || $match === 'W/' . $etag || 'W/' . $match === $etag) {
                    $matches = true;
                    break;
                }
            }
            if (!$matches) {
                return false;
            }
        }
        if ($modifiedSince !== null && $modifiedSince !== '') {
            $lastModified = $response->headers->get('Last-Modified');
            $lm = $lastModified ? strtotime($lastModified) : false;
            $ms = strtotime($modifiedSince);
            if ($lm === false || $ms === false || $lm > $ms) {
                return false;
            }
        }
        return true;
    }

    /**
     * req.ip under Express's "trust proxy" (proxy-addr): addresses are [socket, ...X-Forwarded-For
     * right to left]; a hop count N trusts N of them. Not set = the socket address.
     */
    public static function clientIp(SymfonyRequest $sr): string
    {
        $remote = (string) ($sr->server->get('REMOTE_ADDR') ?? '');
        $setting = (string) (Env::get('TRUST_PROXY') ?? '');
        if ($setting === '' || $setting === 'false') {
            return $remote;
        }
        $xff = (string) ($sr->headers->get('x-forwarded-for') ?? '');
        $chain = $xff === '' ? [] : array_reverse(array_map('trim', explode(',', $xff)));
        $addrs = [$remote, ...$chain];
        if ($setting === 'true') {
            return $addrs[count($addrs) - 1];
        }
        if (ctype_digit($setting)) {
            return $addrs[min((int) $setting, count($addrs) - 1)];
        }
        // Named ranges ("loopback", "uniquelocal", ...): walk while the hop is trusted.
        foreach ($addrs as $i => $addr) {
            if ($i === count($addrs) - 1 || !self::inNamedRange($addr, $setting)) {
                return $addr;
            }
        }
        return $remote;
    }

    private static function inNamedRange(string $ip, string $setting): bool
    {
        $ranges = [
            'loopback' => ['127.0.0.0/8', '::1/128'],
            'linklocal' => ['169.254.0.0/16', 'fe80::/10'],
            'uniquelocal' => ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7'],
        ];
        foreach (array_map('trim', explode(',', $setting)) as $name) {
            foreach ($ranges[$name] ?? [$name] as $cidr) {
                if (\Symfony\Component\HttpFoundation\IpUtils::checkIp($ip, $cidr)) {
                    return true;
                }
            }
        }
        return false;
    }
}
