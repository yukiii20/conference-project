<?php

declare(strict_types=1);

namespace App\Http;

/** multer's memoryStorage file: the bytes plus the client's filename and declared type. */
final class UploadedFile
{
    public function __construct(
        public readonly string $fieldname,
        public readonly string $originalname,
        public readonly string $mimetype,
        public readonly string $buffer,
    ) {
    }

    public function size(): int
    {
        return strlen($this->buffer);
    }
}
