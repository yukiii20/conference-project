<?php

declare(strict_types=1);

namespace App\Http;

/**
 * An Express 4 Router: routes are tried in registration order, paths are matched
 * case-insensitively, a trailing slash is ignored (strict: false), `:name` matches one
 * segment, `*` matches the rest (req.params[0]). A HEAD request is answered by the GET route.
 *
 * A route is [method, path, ...middleware, handler]. Middleware is
 * fn(Req $req, callable $next): Response, the handler fn(Req $req): Response.
 */
final class Router
{
    /** @var list<array{method:string, regex:string, keys:list<string>, stack:list<callable>, path:string}> */
    private array $routes = [];

    public function get(string $path, callable ...$stack): self
    {
        return $this->add('GET', $path, $stack);
    }

    public function post(string $path, callable ...$stack): self
    {
        return $this->add('POST', $path, $stack);
    }

    public function put(string $path, callable ...$stack): self
    {
        return $this->add('PUT', $path, $stack);
    }

    public function patch(string $path, callable ...$stack): self
    {
        return $this->add('PATCH', $path, $stack);
    }

    public function delete(string $path, callable ...$stack): self
    {
        return $this->add('DELETE', $path, $stack);
    }

    /** @param list<callable> $stack */
    private function add(string $method, string $path, array $stack): self
    {
        [$regex, $keys] = self::compile($path);
        $this->routes[] = ['method' => $method, 'regex' => $regex, 'keys' => $keys, 'stack' => array_values($stack), 'path' => $path];
        return $this;
    }

    /** @return list<array{method:string, path:string}> for the route inventory test */
    public function describe(): array
    {
        return array_map(static fn ($r) => ['method' => $r['method'], 'path' => $r['path']], $this->routes);
    }

    /**
     * The first route matching method + path, with decoded params.
     *
     * @return array{stack: list<callable>, params: array<string,string>}|null
     */
    public function match(string $method, string $path): ?array
    {
        foreach ($this->routes as $route) {
            if ($route['method'] !== $method && !($method === 'HEAD' && $route['method'] === 'GET')) {
                continue;
            }
            if (!preg_match($route['regex'], $path, $m)) {
                continue;
            }
            $params = [];
            foreach ($route['keys'] as $i => $key) {
                if (!isset($m[$i + 1]) || $m[$i + 1] === '') {
                    continue;
                }
                $params[$key] = self::decodeParam($m[$i + 1]);
            }
            return ['stack' => $route['stack'], 'params' => $params];
        }
        return null;
    }

    /** decodeURIComponent; Express answers a malformed escape with a 400 error object (which the app's handler turned into a 500). */
    private static function decodeParam(string $v): string
    {
        if (preg_match('/%(?![0-9a-fA-F]{2})/', $v)) {
            throw new \App\Core\BodyParseError("Failed to decode param '{$v}'");
        }
        $d = rawurldecode($v);
        if (!mb_check_encoding($d, 'UTF-8')) {
            throw new \App\Core\BodyParseError("Failed to decode param '{$v}'");
        }
        return $d;
    }

    /**
     * path-to-regexp 0.1.x (Express 4) for the patterns this app uses.
     *
     * @return array{0: string, 1: list<string>}
     */
    public static function compile(string $path): array
    {
        $keys = [];
        $regex = '';
        $i = 0;
        $len = strlen($path);
        while ($i < $len) {
            $ch = $path[$i];
            if ($ch === ':' && preg_match('/\G:(\w+)(\?)?/', $path, $m, 0, $i)) {
                $keys[] = $m[1];
                $regex .= isset($m[2]) && $m[2] === '?' ? '(?:([^/]+?))?' : '([^/]+?)';
                $i += strlen($m[0]);
                continue;
            }
            if ($ch === '*') {
                $keys[] = (string) count(array_filter($keys, 'is_numeric'));
                $regex .= '(.*)';
                $i++;
                continue;
            }
            $regex .= preg_quote($ch, '#');
            $i++;
        }
        return ['#^' . $regex . '/?$#i', $keys];
    }
}
