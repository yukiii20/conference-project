<?php

declare(strict_types=1);

namespace App\Core;

class NotFoundError extends AppError
{
    public function __construct(string $message = 'Not found.')
    {
        parent::__construct(404, $message);
    }
}
