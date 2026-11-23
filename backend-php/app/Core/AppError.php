<?php

declare(strict_types=1);

namespace App\Core;

/** Port of server/src/utils/errors.ts. Rendered as { error: { message, fields?, code? } }. */
class AppError extends \RuntimeException
{
    /** @param array<string,string>|\stdClass|null $fields */
    public function __construct(
        public readonly int $statusCode,
        string $message,
        public array|\stdClass|null $fields = null,
        public ?string $errorCode = null,
    ) {
        parent::__construct($message);
    }
}
