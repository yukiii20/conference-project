<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Core\Env;
use App\Core\JsString;
use App\Http\Req;
use App\Http\Res;

/**
 * Port of middleware/rateLimit.ts (express-rate-limit 7, MemoryStore semantics: a fixed window
 * per key that starts at the key's first hit; draft-6 RateLimit-* headers; Retry-After and the
 * configured JSON message on 429). Skipped entirely under NODE_ENV=test, like Node.
 *
 * Node kept the counters in process memory; PHP-FPM has many processes, so the counters live in
 * APCu (shared by every worker on one machine) or, without APCu, in a locked file.
 */
final class RateLimit
{
    private const TOO_MANY = 'Too many attempts. Please wait a few minutes and try again.';

    /** @param (callable(Req): string)|null $key */
    public static function make(string $name, int $windowMs, int $limit, string $message, ?callable $key = null): \Closure
    {
        return static function (Req $req, callable $next) use ($name, $windowMs, $limit, $message, $key) {
            if (Env::isTest()) {
                return $next($req);
            }
            $k = $name . ':' . ($key !== null ? $key($req) : $req->ip);
            [$hits, $resetMs] = RateLimitStore::increment($k, $windowMs);
            $resetSeconds = max(0, (int) ceil(($resetMs - (int) floor(microtime(true) * 1000)) / 1000));
            $headers = [
                'RateLimit-Policy' => $limit . ';w=' . (int) ceil($windowMs / 1000),
                'RateLimit-Limit' => (string) $limit,
                'RateLimit-Remaining' => (string) max($limit - $hits, 0),
            ];
            if ($resetSeconds) {
                $headers['RateLimit-Reset'] = (string) $resetSeconds;
            }
            if ($hits > $limit) {
                $headers['Retry-After'] = (string) $resetSeconds;
                return Res::json(['error' => ['message' => $message]], 429, $headers);
            }
            // Headers are set before the handler runs in Node, so they ride on errors too.
            $req->locals['rateLimitHeaders'] = array_merge($req->locals['rateLimitHeaders'] ?? [], $headers);
            return $next($req);
        };
    }

    public static function auth(): \Closure
    {
        return self::make('auth', 15 * 60 * 1000, 20, self::TOO_MANY);
    }

    public static function forgotPasswordIp(): \Closure
    {
        return self::make('forgot-ip', 15 * 60 * 1000, 5, self::TOO_MANY);
    }

    public static function forgotPasswordEmail(): \Closure
    {
        return self::make('forgot-email', 15 * 60 * 1000, 5, self::TOO_MANY, static function (Req $req): string {
            $body = $req->body;
            $email = '';
            if (($body instanceof \ArrayAccess || is_array($body)) && isset($body['email']) && is_string($body['email'])) {
                $email = JsString::lower(JsString::trim($body['email']));
            }
            return $email !== '' ? $email : ($req->ip !== '' ? $req->ip : 'unknown');
        });
    }

    public static function upload(): \Closure
    {
        return self::make('upload', 15 * 60 * 1000, 60, 'Too many uploads. Please wait a few minutes and try again.');
    }

    public static function suggestionIp(): \Closure
    {
        return self::make('suggest-ip', 10 * 60 * 1000, 3, 'Too many suggestions from this address. Please try again later.');
    }

    public static function suggestionDaily(): \Closure
    {
        return self::make('suggest-day', 24 * 60 * 60 * 1000, 20, 'Too many suggestions from this address. Please try again later.');
    }

    public static function machine(): \Closure
    {
        return self::make('machine', 60 * 1000, 60, 'Too many requests.');
    }

    public static function emailTrigger(): \Closure
    {
        return self::make(
            'email-trigger',
            15 * 60 * 1000,
            30,
            'Too many emails sent in a short time. Please wait a few minutes and try again.',
            static fn (Req $req): string => $req->user !== null ? 'user:' . $req->user->id : 'ip:' . ($req->ip !== '' ? $req->ip : 'unknown'),
        );
    }

    private static function perUser(Req $req): string
    {
        return 'user:' . ($req->user?->id ?? ($req->ip !== '' ? $req->ip : 'unknown'));
    }

    public static function qaAsk(): \Closure
    {
        return self::make('qa-ask', 10 * 60 * 1000, 20, 'Too many questions in a short time. Please wait a few minutes.', self::perUser(...));
    }

    public static function qaVote(): \Closure
    {
        return self::make('qa-vote', 10 * 60 * 1000, 120, 'Too many votes in a short time. Please wait a few minutes.', self::perUser(...));
    }

    public static function publicDownload(): \Closure
    {
        return self::make('public-download', 10 * 60 * 1000, 30, 'Too many downloads. Please try again in a few minutes.');
    }
}
