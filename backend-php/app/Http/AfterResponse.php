<?php

declare(strict_types=1);

namespace App\Http;

use App\Auth\SessionScope;
use App\Support\Log;

/**
 * Work Node started without awaiting (e.g. "send the queued email now") runs here, after the
 * response has been flushed to the client (fastcgi_finish_request). Outside any session scope,
 * as in Node. Failures are logged, never shown to the client.
 */
final class AfterResponse
{
    /** @var list<callable> */
    private static array $tasks = [];

    public static function defer(callable $task): void
    {
        self::$tasks[] = $task;
    }

    public static function run(): void
    {
        SessionScope::clear();
        while (($task = array_shift(self::$tasks)) !== null) {
            try {
                $task();
            } catch (\Throwable $e) {
                Log::error('Background task failed', $e);
            }
        }
    }
}
