<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Core\Env;

/** Fixed-window counters shared by every PHP worker: APCu when available, else one locked JSON file. */
final class RateLimitStore
{
    /** @return array{0: int, 1: int} [hits in the current window, window reset time in ms] */
    public static function increment(string $key, int $windowMs): array
    {
        $now = (int) floor(microtime(true) * 1000);
        $useApcu = Env::get('RATE_LIMIT_STORE') !== 'file' && function_exists('apcu_enabled') && apcu_enabled();
        return $useApcu ? self::apcu($key, $windowMs, $now) : self::file($key, $windowMs, $now);
    }

    private static function apcu(string $key, int $windowMs, int $now): array
    {
        $k = 'rl:' . $key;
        $lockKey = $k . ':lock';
        for ($i = 0; $i < 50 && !apcu_add($lockKey, 1, 2); $i++) {
            usleep(1000);
        }
        try {
            $entry = apcu_fetch($k);
            if (!is_array($entry) || $entry[1] <= $now) {
                $entry = [0, $now + $windowMs];
            }
            $entry[0]++;
            apcu_store($k, $entry, (int) ceil(($entry[1] - $now) / 1000) + 1);
            return $entry;
        } finally {
            apcu_delete($lockKey);
        }
    }

    private static function file(string $key, int $windowMs, int $now): array
    {
        $path = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'cms-rate-limit.json';
        $fh = fopen($path, 'c+');
        if ($fh === false) {
            return [1, $now + $windowMs];
        }
        try {
            flock($fh, LOCK_EX);
            $data = json_decode((string) stream_get_contents($fh), true) ?: [];
            foreach ($data as $k => $e) {
                if ($e[1] <= $now) {
                    unset($data[$k]);
                }
            }
            $entry = $data[$key] ?? [0, $now + $windowMs];
            $entry[0]++;
            $data[$key] = $entry;
            ftruncate($fh, 0);
            rewind($fh);
            fwrite($fh, (string) json_encode($data));
            fflush($fh);
            return $entry;
        } finally {
            flock($fh, LOCK_UN);
            fclose($fh);
        }
    }
}
