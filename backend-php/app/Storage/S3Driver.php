<?php

declare(strict_types=1);

namespace App\Storage;

use Aws\S3\Exception\S3Exception;
use Aws\S3\S3Client;

/**
 * Any S3-compatible bucket (R2, B2, AWS, MinIO). One private bucket holds both areas under
 * "public/" and "private/" prefixes - the same layout and keys as the Node backend.
 */
final class S3Driver implements StorageDriver
{
    private S3Client $client;
    private string $bucket;

    /** @param array{endpoint: ?string, region: string, bucket: string, key: string, secret: string, pathStyle: ?bool} $o */
    public function __construct(array $o)
    {
        $this->bucket = $o['bucket'];
        $config = [
            'version' => 'latest',
            'region' => $o['region'],
            'credentials' => ['key' => $o['key'], 'secret' => $o['secret']],
            'use_path_style_endpoint' => $o['pathStyle'] ?? $o['endpoint'] !== null,
        ];
        if ($o['endpoint'] !== null) {
            $config['endpoint'] = $o['endpoint'];
        }
        $this->client = new S3Client($config);
    }

    public function name(): string
    {
        return 's3';
    }

    private function key(string $area, string $key): string
    {
        Storage::assertSafeKey($key);
        return $area . '/' . $key;
    }

    private static function isNotFound(\Throwable $e): bool
    {
        return $e instanceof S3Exception && (in_array($e->getAwsErrorCode(), ['NoSuchKey', 'NotFound'], true) || $e->getStatusCode() === 404);
    }

    public function put(string $area, string $key, string $body, ?string $contentType = null): void
    {
        $this->client->putObject([
            'Bucket' => $this->bucket,
            'Key' => $this->key($area, $key),
            'Body' => $body,
            'ContentType' => $contentType ?? Storage::contentTypeFor($key),
        ]);
    }

    public function get(string $area, string $key): ?string
    {
        $object = $this->open($area, $key);
        if ($object === null) {
            return null;
        }
        try {
            return (string) stream_get_contents($object->stream);
        } finally {
            $object->close();
        }
    }

    public function open(string $area, string $key): ?StoredObject
    {
        try {
            $out = $this->client->getObject(['Bucket' => $this->bucket, 'Key' => $this->key($area, $key), '@http' => ['stream' => true]]);
        } catch (\Throwable $e) {
            if (self::isNotFound($e)) {
                return null;
            }
            throw $e;
        }
        $body = $out['Body'];
        $stream = \GuzzleHttp\Psr7\StreamWrapper::getResource($body);
        $lastModified = $out['LastModified'] ?? null;
        return new StoredObject(
            $stream,
            isset($out['ContentLength']) ? (int) $out['ContentLength'] : null,
            $out['ContentType'] ?? Storage::contentTypeFor($key),
            $out['ETag'] ?? null,
            $lastModified instanceof \DateTimeInterface ? \DateTimeImmutable::createFromInterface($lastModified) : null,
        );
    }

    public function exists(string $area, string $key): bool
    {
        try {
            $this->client->headObject(['Bucket' => $this->bucket, 'Key' => $this->key($area, $key)]);
            return true;
        } catch (\Throwable $e) {
            if (self::isNotFound($e)) {
                return false;
            }
            throw $e;
        }
    }

    public function delete(string $area, string $key): void
    {
        $this->client->deleteObject(['Bucket' => $this->bucket, 'Key' => $this->key($area, $key)]);
    }
}
