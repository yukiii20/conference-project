<?php

declare(strict_types=1);

namespace App\Storage;

use App\Core\AppError;
use App\Http\Req;
use App\Http\Res;
use Symfony\Component\HttpFoundation\Response;

/** Port of storage/send.ts. */
final class FileSend
{
    public const FILE_MISSING_CODE = 'file_missing';
    public const FILE_MISSING_MESSAGE = 'This file is missing from storage. Please ask the author to upload it again.';
    public const PUBLIC_FILE_CACHE_CONTROL = 'public, max-age=3600';

    public static function missing(?string $message = null): AppError
    {
        return new AppError(404, $message ?? self::FILE_MISSING_MESSAGE, null, self::FILE_MISSING_CODE);
    }

    /** If-None-Match names this version (weak comparison). */
    public static function etagMatches(?string $ifNoneMatch, ?string $etag): bool
    {
        if (!$ifNoneMatch || !$etag) {
            return false;
        }
        $strip = static fn (string $t): string => (string) preg_replace('#^W/#', '', trim($t));
        $current = $strip($etag);
        foreach (explode(',', $ifNoneMatch) as $tag) {
            if (trim($tag) === '*' || $strip($tag) === $current) {
                return true;
            }
        }
        return false;
    }

    private static function streamBody(StoredObject $object): \Closure
    {
        return static function () use ($object): void {
            $out = fopen('php://output', 'wb');
            stream_copy_to_stream($object->stream, $out);
            fclose($out);
            $object->close();
        };
    }

    /** Streams a stored file. Callers must have checked permission first. */
    public static function sendStoredFile(string $area, string $key, string $filename, string $disposition = 'attachment', ?string $contentType = null, ?string $missingMessage = null): Response
    {
        $object = Storage::driver()->open($area, $key);
        if ($object === null) {
            throw self::missing($missingMessage);
        }
        $headers = [
            'Content-Type' => $contentType ?? $object->contentType ?? Storage::contentTypeFor($key),
            'Content-Disposition' => Res::contentDisposition($disposition, $filename),
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, no-store',
        ];
        if ($object->size !== null) {
            $headers['Content-Length'] = (string) $object->size;
        }
        return Res::stream(self::streamBody($object), 200, $headers);
    }

    public static function sendPrivateFile(string $key, string $filename, ?string $contentType = null, string $disposition = 'attachment', ?string $missingMessage = null): Response
    {
        return self::sendStoredFile('private', $key, $filename, $disposition, $contentType, $missingMessage);
    }

    /** GET/HEAD /files/public/<key>: short cache + ETag, 304 when unchanged. */
    public static function publicFileHandler(Req $req): Response
    {
        $key = $req->params['0'] ?? '';
        try {
            Storage::assertSafeKey($key);
        } catch (\InvalidArgumentException) {
            return Res::json(['error' => ['message' => 'Not found.']], 404);
        }
        $object = Storage::driver()->open('public', $key);
        if ($object === null) {
            return Res::json(['error' => ['message' => 'This image is missing from storage. Please upload it again.', 'code' => self::FILE_MISSING_CODE]], 404, ['Cache-Control' => 'no-store']);
        }
        $headers = ['Cache-Control' => self::PUBLIC_FILE_CACHE_CONTROL, 'X-Content-Type-Options' => 'nosniff'];
        if ($object->etag) {
            $headers['ETag'] = $object->etag;
        }
        if ($object->lastModified) {
            $headers['Last-Modified'] = $object->lastModified->setTimezone(new \DateTimeZone('UTC'))->format('D, d M Y H:i:s') . ' GMT';
        }
        if (self::etagMatches($req->header('if-none-match'), $object->etag)) {
            $object->close();
            return Res::end(304, $headers);
        }
        $headers['Content-Type'] = $object->contentType ?? Storage::contentTypeFor($key);
        if ($object->size !== null) {
            $headers['Content-Length'] = (string) $object->size;
        }
        if ($req->method === 'HEAD') {
            $object->close();
            return Res::end(200, $headers);
        }
        return Res::stream(self::streamBody($object), 200, $headers);
    }
}
