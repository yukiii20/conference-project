<?php

declare(strict_types=1);

namespace App\Storage;

/** Files under <root>/public and <root>/private, exactly the folder layout Node used. */
final class LocalDriver implements StorageDriver
{
    public function __construct(private readonly string $root)
    {
    }

    public function name(): string
    {
        return 'local';
    }

    private function full(string $area, string $key): string
    {
        Storage::assertSafeKey($key);
        return $this->root . DIRECTORY_SEPARATOR . ($area === 'public' ? 'public' : 'private') . DIRECTORY_SEPARATOR
            . str_replace('/', DIRECTORY_SEPARATOR, $key);
    }

    public function put(string $area, string $key, string $body, ?string $contentType = null): void
    {
        $full = $this->full($area, $key);
        $dir = dirname($full);
        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new \RuntimeException('Could not create the storage folder.');
        }
        // Write to a temp file and rename, so a reader never sees half a file.
        $tmp = $full . '.' . bin2hex(random_bytes(4)) . '.tmp';
        if (file_put_contents($tmp, $body) === false || !rename($tmp, $full)) {
            @unlink($tmp);
            throw new \RuntimeException('Could not write the file.');
        }
    }

    public function get(string $area, string $key): ?string
    {
        $full = $this->full($area, $key);
        if (!is_file($full)) {
            return null;
        }
        $data = file_get_contents($full);
        return $data === false ? null : $data;
    }

    public function open(string $area, string $key): ?StoredObject
    {
        $full = $this->full($area, $key);
        clearstatcache(true, $full);
        if (!is_file($full)) {
            return null;
        }
        $fh = fopen($full, 'rb');
        if ($fh === false) {
            return null;
        }
        $stat = fstat($fh);
        $size = (int) $stat['size'];
        $mtime = (int) $stat['mtime'];
        // Node: W/"<size hex>-<mtimeMs hex>". PHP only sees whole seconds, so the tag differs from
        // Node's by the sub-second part: a browser revalidates each file once after the switch.
        return new StoredObject(
            $fh,
            $size,
            Storage::contentTypeFor($key),
            'W/"' . dechex($size) . '-' . dechex($mtime * 1000) . '"',
            (new \DateTimeImmutable('@' . $mtime)),
        );
    }

    public function exists(string $area, string $key): bool
    {
        return is_file($this->full($area, $key));
    }

    public function delete(string $area, string $key): void
    {
        $full = $this->full($area, $key);
        if (is_file($full) && !@unlink($full) && is_file($full)) {
            throw new \RuntimeException('Could not delete the file.');
        }
    }
}
