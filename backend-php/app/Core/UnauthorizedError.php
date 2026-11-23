<?php

declare(strict_types=1);

namespace App\Core;

class UnauthorizedError extends AppError
{
    public function __construct(string $message = 'You must be signed in.')
    {
        parent::__construct(401, $message);
    }
}
