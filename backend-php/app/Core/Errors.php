<?php

declare(strict_types=1);

namespace App\Core;

final class Errors
{
    /** Port of mapDatabaseError: trigger SIGNAL 45000 becomes 409 with its own message; anything else is rethrown. */
    public static function mapDatabaseError(\Throwable $err): never
    {
        if ($err instanceof DbError && $err->isSignal()) {
            throw new ConflictError($err->sqlMessage);
        }
        throw $err;
    }

    public static function isSignalError(mixed $err): bool
    {
        return $err instanceof DbError && $err->isSignal();
    }
}
