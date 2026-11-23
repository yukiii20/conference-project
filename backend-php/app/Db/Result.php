<?php

declare(strict_types=1);

namespace App\Db;

/** mysql2's ResultSetHeader: what an INSERT/UPDATE/DELETE returns. */
final class Result
{
    public function __construct(
        public readonly int $affectedRows,
        public readonly int $insertId,
    ) {
    }
}
