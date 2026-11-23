<?php

declare(strict_types=1);

namespace App\Http;

/** multer.MulterError equivalent: LIMIT_FILE_SIZE (tooLarge) or anything else. */
final class UploadError extends \RuntimeException
{
    public function __construct(public readonly bool $tooLarge, string $code = '')
    {
        parent::__construct($code);
    }
}
