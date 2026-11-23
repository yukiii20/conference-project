<?php

declare(strict_types=1);

namespace App\Http;

/**
 * Set-Cookie headers queued during a request (res.cookie / res.clearCookie), written by the
 * kernel onto whatever response is finally sent. Formatted exactly like Express's `cookie`
 * serializer: name=value; Max-Age=N; Path=/; Expires=...; HttpOnly; Secure; SameSite=Lax
 */
final class CookieJar
{
    /** @var list<string> */
    private static array $headers = [];

    /** @param array{maxAgeMs?: int, httpOnly?: bool, secure?: bool, sameSite?: string, path?: string} $opts */
    public static function set(string $name, string $value, array $opts): void
    {
        $parts = [$name . '=' . Res::encodeURIComponent($value)];
        if (isset($opts['maxAgeMs'])) {
            $parts[] = 'Max-Age=' . intdiv($opts['maxAgeMs'], 1000);
        }
        $parts[] = 'Path=' . ($opts['path'] ?? '/');
        if (isset($opts['maxAgeMs'])) {
            $expires = (int) floor((microtime(true) * 1000 + $opts['maxAgeMs']) / 1000);
            $parts[] = 'Expires=' . gmdate('D, d M Y H:i:s', $expires) . ' GMT';
        }
        if (!empty($opts['httpOnly'])) {
            $parts[] = 'HttpOnly';
        }
        if (!empty($opts['secure'])) {
            $parts[] = 'Secure';
        }
        if (isset($opts['sameSite'])) {
            $parts[] = 'SameSite=' . ucfirst(strtolower($opts['sameSite']));
        }
        self::$headers[] = implode('; ', $parts);
    }

    /** res.clearCookie(name, { path }) */
    public static function clear(string $name, string $path = '/'): void
    {
        self::$headers[] = $name . '=; Path=' . $path . '; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
    }

    /** @return list<string> */
    public static function drain(): array
    {
        $h = self::$headers;
        self::$headers = [];
        return $h;
    }
}
