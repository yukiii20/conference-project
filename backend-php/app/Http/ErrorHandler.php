<?php

declare(strict_types=1);

namespace App\Http;

use App\Core\AppError;
use App\Core\DbError;
use App\Core\Json;
use App\Support\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * Port of middleware/errorHandler.ts. Never leaks raw SQL: trigger errors (SQLSTATE 45000)
 * carry plain-English messages and are shown as-is; other MySQL errors get a generic message.
 */
final class ErrorHandler
{
    public static function render(\Throwable $err): Response
    {
        if ($err instanceof AppError) {
            $error = ['message' => $err->getMessage()];
            if ($err->fields !== null) {
                $error['fields'] = $err->fields === [] ? Json::obj() : $err->fields;
            }
            if ($err->errorCode !== null && $err->errorCode !== '') {
                $error['code'] = $err->errorCode;
            }
            return Res::json(['error' => $error], $err->statusCode);
        }

        if ($err instanceof UploadError) {
            $message = $err->tooLarge ? 'This file is too large.' : 'Could not read the uploaded file.';
            return Res::json(['error' => ['message' => $message]], 400);
        }

        if ($err instanceof DbError) {
            if ($err->sqlState === '45000' && $err->sqlMessage !== '') {
                return Res::json(['error' => ['message' => $err->sqlMessage]], 400);
            }
            if ($err->errno === 1062) {
                return Res::json(['error' => ['message' => 'This already exists.']], 409);
            }
            if ($err->errno === 3819 || $err->errno === 4025) {
                return Res::json(['error' => ['message' => 'One of the values provided is not valid.']], 400);
            }
            Log::error('Unhandled MySQL error', $err);
            return Res::json(['error' => ['message' => 'Something went wrong. Please try again.']], 500);
        }

        Log::error('Unhandled error', $err);
        return Res::json(['error' => ['message' => 'Something went wrong. Please try again.']], 500);
    }

    /** finalhandler's 404 page for a request no route matched. */
    public static function notFound(string $method, string $originalUrl): Response
    {
        $path = explode('?', $originalUrl, 2)[0];
        $body = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<title>Error</title>\n</head>\n<body>\n<pre>"
            . 'Cannot ' . htmlspecialchars($method, ENT_QUOTES) . ' ' . htmlspecialchars(self::encodeUrl($path), ENT_QUOTES | ENT_HTML5)
            . "</pre>\n</body>\n</html>\n";
        return new Response($body, 404, [
            'Content-Security-Policy' => "default-src 'none'",
            'X-Content-Type-Options' => 'nosniff',
            'Content-Type' => 'text/html; charset=utf-8',
        ]);
    }

    /** encodeurl: encode characters not allowed in a URL, keep existing %XX escapes. */
    private static function encodeUrl(string $url): string
    {
        return (string) preg_replace_callback(
            '/%(?![0-9A-Fa-f]{2})|[^\x21\x23-\x3B\x3D\x3F-\x5B\x5D\x5F\x61-\x7A\x7E]/',
            static fn ($m) => rawurlencode($m[0]),
            $url,
        );
    }
}
