<?php

declare(strict_types=1);

namespace App\Support;

/**
 * console.log / console.error equivalent: writes to stderr (php-fpm/docker logs).
 * Never logs request bodies, cookies or secrets: only the message and the exception chain.
 */
final class Log
{
    public static function info(string $message): void
    {
        self::write('info', $message);
    }

    public static function warn(string $message): void
    {
        self::write('warn', $message);
    }

    public static function error(string $message, ?\Throwable $e = null): void
    {
        if ($e !== null) {
            $message .= ': ' . get_class($e) . ': ' . $e->getMessage() . "\n" . $e->getTraceAsString();
        }
        self::write('error', $message);
    }

    private static function write(string $level, string $message): void
    {
        $line = '[' . gmdate('Y-m-d\TH:i:s\Z') . "] {$level}: {$message}\n";
        if (defined('STDERR')) {
            fwrite(STDERR, $line);
        } else {
            error_log(rtrim($line));
        }
    }
}
