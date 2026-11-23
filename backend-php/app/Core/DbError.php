<?php

declare(strict_types=1);

namespace App\Core;

/** A MySQL error with the fields the Node error handler looked at (errno, sqlState, sqlMessage). */
class DbError extends \RuntimeException
{
    public function __construct(
        public readonly int $errno,
        public readonly string $sqlState,
        public readonly string $sqlMessage,
        ?\Throwable $previous = null,
    ) {
        parent::__construct($sqlMessage, 0, $previous);
    }

    public function isSignal(): bool
    {
        return $this->sqlState === '45000';
    }
}
