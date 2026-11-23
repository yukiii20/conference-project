<?php

declare(strict_types=1);

namespace App\Core;

class BadRequestError extends AppError
{
    /** @param array<string,string>|\stdClass|null $fields */
    public function __construct(string $message, array|\stdClass|null $fields = null)
    {
        parent::__construct(400, $message, $fields);
    }
}
