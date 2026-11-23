<?php

declare(strict_types=1);

namespace App\Http;

use App\Core\Json;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/** Builders for the responses Express produced (res.json, res.send, res.end, file sends). */
final class Res
{
    /** Marks a response whose body went through res.send() (gets an ETag, may become a 304). */
    public const SENT_HEADER = 'X-Internal-Res-Send';

    /** @var \WeakMap<Response, string>|null Cache-Control exactly as written (Symfony rewrites it). */
    private static ?\WeakMap $cacheControl = null;

    private static function remember(Response $r, array $headers): Response
    {
        foreach ($headers as $k => $v) {
            if (strtolower((string) $k) === 'cache-control') {
                self::$cacheControl ??= new \WeakMap();
                self::$cacheControl[$r] = (string) $v;
            }
        }
        return $r;
    }

    public static function rawCacheControl(Response $r): ?string
    {
        return self::$cacheControl[$r] ?? null;
    }

    /** res.status(s).json(data) */
    public static function json(mixed $data, int $status = 200, array $headers = []): Response
    {
        $r = new Response(Json::encode($data), $status, $headers + ['Content-Type' => 'application/json; charset=utf-8']);
        $r->headers->set(self::SENT_HEADER, '1');
        return self::remember($r, $headers);
    }

    /** res.send(string): text/html unless a Content-Type is given. */
    public static function send(string $body, int $status = 200, array $headers = []): Response
    {
        $r = new Response($body, $status, $headers + ['Content-Type' => 'text/html; charset=utf-8']);
        $r->headers->set(self::SENT_HEADER, '1');
        return self::remember($r, $headers);
    }

    /** res.status(s).end(): no body, no Content-Type. */
    public static function end(int $status = 200, array $headers = []): Response
    {
        return self::remember(new Response('', $status, $headers), $headers);
    }

    /** sendBuffer() from storage/send.ts. */
    public static function buffer(string $body, string $filename, string $contentType, string $disposition = 'attachment'): Response
    {
        $headers = [
            'Content-Type' => $contentType,
            'Content-Disposition' => self::contentDisposition($disposition, $filename),
            'Content-Length' => (string) strlen($body),
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, no-store',
        ];
        return self::remember(new Response($body, 200, $headers), $headers);
    }

    /** A streamed body (pipe(res)); headers are sent first, then $writer echoes chunks. */
    public static function stream(callable $writer, int $status = 200, array $headers = []): StreamedResponse
    {
        $r = new StreamedResponse($writer, $status, $headers);
        self::remember($r, $headers);
        return $r;
    }

    /** `attachment; filename="<ascii>"; filename*=UTF-8''<encoded>` exactly as storage/send.ts built it. */
    public static function contentDisposition(string $type, string $filename): string
    {
        // JS replaces per UTF-16 unit, so a character outside the BMP (emoji) becomes "__".
        $ascii = preg_replace_callback('/[^\x20-\x7E]/u', static fn ($m) => strlen($m[0]) === 4 ? '__' : '_', $filename) ?? $filename;
        $ascii = str_replace(['"', '\\'], '_', $ascii);
        return $type . '; filename="' . $ascii . '"; filename*=UTF-8\'\'' . self::encodeURIComponent($filename);
    }

    /** JavaScript encodeURIComponent. */
    public static function encodeURIComponent(string $s): string
    {
        return strtr(rawurlencode($s), ['%21' => '!', '%27' => "'", '%28' => '(', '%29' => ')', '%2A' => '*', '%7E' => '~']);
    }
}
