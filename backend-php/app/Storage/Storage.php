<?php

declare(strict_types=1);

namespace App\Storage;

use App\Core\Env;

/**
 * Port of storage/driver.ts: every uploaded or generated file goes through this interface.
 * 'public' = logos, banners, photos (served at /files/public/<key>); 'private' = files only
 * sent by a route that already checked permission. Keys are the relative paths in the DB.
 */
final class Storage
{
    private static ?StorageDriver $driver = null;

    private const CONTENT_TYPES = [
        'png' => 'image/png',
        'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'webp' => 'image/webp',
        'gif' => 'image/gif',
        'svg' => 'image/svg+xml',
        'pdf' => 'application/pdf',
        'doc' => 'application/msword',
        'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'ppt' => 'application/vnd.ms-powerpoint',
        'pptx' => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'xls' => 'application/vnd.ms-excel',
        'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'zip' => 'application/zip',
    ];

    public static function driver(): StorageDriver
    {
        if (self::$driver === null) {
            $name = Env::get('STORAGE_DRIVER');
            self::$driver = ($name === 's3' || $name === 'r2')
                ? new S3Driver(self::s3OptionsFromEnv() ?? throw new \RuntimeException('S3 settings missing.'))
                : new LocalDriver(self::root());
        }
        return self::$driver;
    }

    public static function setDriverForTesting(?StorageDriver $driver): void
    {
        self::$driver = $driver;
    }

    /** STORAGE_DIR (or STORAGE_ROOT), relative paths resolved against the backend folder. */
    public static function root(): string
    {
        $dir = (string) (Env::get('STORAGE_DIR') ?: 'storage-files');
        $isAbsolute = str_starts_with($dir, '/') || preg_match('#^[A-Za-z]:[\\\\/]#', $dir) === 1;
        return $isAbsolute ? $dir : dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . $dir;
    }

    /** Rejects anything that could escape its folder ("..", absolute paths, backslashes, empty parts). */
    public static function assertSafeKey(string $key): void
    {
        if ($key === '' || str_starts_with($key, '/') || str_contains($key, '\\')) {
            throw new \InvalidArgumentException('Unsafe storage key.');
        }
        foreach (explode('/', $key) as $part) {
            if ($part === '..' || $part === '') {
                throw new \InvalidArgumentException('Unsafe storage key.');
            }
        }
    }

    public static function contentTypeFor(string $key): string
    {
        $parts = explode('.', $key);
        return self::CONTENT_TYPES[strtolower((string) end($parts))] ?? 'application/octet-stream';
    }

    /** @return array{endpoint: ?string, region: string, bucket: string, key: string, secret: string, pathStyle: ?bool}|null */
    public static function s3OptionsFromEnv(): ?array
    {
        $e = static fn (string $k): string => (string) (Env::get($k) ?? '');
        if ($e('S3_BUCKET') !== '' && $e('S3_ACCESS_KEY_ID') !== '' && $e('S3_SECRET_ACCESS_KEY') !== '') {
            return [
                'endpoint' => $e('S3_ENDPOINT') !== '' ? $e('S3_ENDPOINT') : null,
                'region' => $e('S3_REGION') !== '' ? $e('S3_REGION') : 'auto',
                'bucket' => $e('S3_BUCKET'),
                'key' => $e('S3_ACCESS_KEY_ID'),
                'secret' => $e('S3_SECRET_ACCESS_KEY'),
                'pathStyle' => $e('S3_FORCE_PATH_STYLE') !== '' ? $e('S3_FORCE_PATH_STYLE') === 'true' : null,
            ];
        }
        if ($e('R2_ACCOUNT_ID') !== '' && $e('R2_BUCKET') !== '' && $e('R2_ACCESS_KEY_ID') !== '' && $e('R2_SECRET_ACCESS_KEY') !== '') {
            return [
                'endpoint' => 'https://' . $e('R2_ACCOUNT_ID') . '.r2.cloudflarestorage.com',
                'region' => 'auto',
                'bucket' => $e('R2_BUCKET'),
                'key' => $e('R2_ACCESS_KEY_ID'),
                'secret' => $e('R2_SECRET_ACCESS_KEY'),
                'pathStyle' => null,
            ];
        }
        return null;
    }
}
