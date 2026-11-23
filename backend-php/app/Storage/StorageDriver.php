<?php

declare(strict_types=1);

namespace App\Storage;

interface StorageDriver
{
    /** 'local' | 's3' */
    public function name(): string;

    public function put(string $area, string $key, string $body, ?string $contentType = null): void;

    /** null when the file does not exist. */
    public function get(string $area, string $key): ?string;

    /** null when the file does not exist. */
    public function open(string $area, string $key): ?StoredObject;

    public function exists(string $area, string $key): bool;

    /** Missing files are not an error. */
    public function delete(string $area, string $key): void;
}
