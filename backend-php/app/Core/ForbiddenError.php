<?php

declare(strict_types=1);

namespace App\Core;

class ForbiddenError extends AppError
{
    public function __construct(string $message = 'You do not have permission to do this.')
    {
        parent::__construct(403, $message);
    }
}
