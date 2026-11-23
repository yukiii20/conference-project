<?php

declare(strict_types=1);

namespace App\Storage;

/** An opened file: $stream is a readable PHP stream resource. */
final class StoredObject
{
    /** @param resource $stream */
    public function __construct(
        public readonly mixed $stream,
        public readonly ?int $size,
        public readonly ?string $contentType,
        public readonly ?string $etag = null,
        public readonly ?\DateTimeImmutable $lastModified = null,
    ) {
    }

    public function close(): void
    {
        if (is_resource($this->stream)) {
            fclose($this->stream);
        }
    }
}
