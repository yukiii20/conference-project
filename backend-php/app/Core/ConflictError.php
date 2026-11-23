<?php

declare(strict_types=1);

namespace App\Core;

class ConflictError extends AppError
{
    public function __construct(string $message)
    {
        parent::__construct(409, $message);
    }
}
