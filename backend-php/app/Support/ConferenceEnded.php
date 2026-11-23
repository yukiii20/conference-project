<?php

declare(strict_types=1);

namespace App\Support;

use App\Core\AppError;
use App\Db\Connection;
use DateTimeImmutable;
use DateTimeInterface;

/**
 * Port of utils/conferenceEnded.ts: a conference has ended once its last day is over in
 * Asia/Kathmandu (end_date 23:59:59 NPT + 1 second).
 */
final class ConferenceEnded
{
    public const CODE = 'conference_ended';
    public const MESSAGE = 'This conference has ended. Conference activity is closed.';

    public static function endsAt(string|DateTimeInterface $endDate): DateTimeImmutable
    {
        $key = $endDate instanceof DateTimeInterface ? $endDate->format('Y-m-d') : substr((string) $endDate, 0, 10);
        [$y, $m, $d] = array_map('intval', explode('-', $key));
        $base = Timezone::zonedWallTimeToUtc($y, $m, $d, 23, 59, 59, Timezone::PLATFORM);
        return Crypto::fromMs(Crypto::toMs($base) + 1000);
    }

    public static function isEnded(string|DateTimeInterface $endDate, ?DateTimeInterface $now = null): bool
    {
        $nowMs = $now !== null ? (int) $now->format('Uv') : Crypto::nowMs();
        return $nowMs >= Crypto::toMs(self::endsAt($endDate));
    }

    public static function error(): AppError
    {
        return new AppError(409, self::MESSAGE, null, self::CODE);
    }

    public static function hasEnded(Connection $db, string $conferenceId): bool
    {
        $row = $db->first('SELECT end_date FROM conferences WHERE id = ? AND deleted_at IS NULL LIMIT 1', [$conferenceId]);
        return $row !== null && self::isEnded($row['end_date']);
    }

    public static function assertNotEnded(Connection $db, string $conferenceId): void
    {
        if (self::hasEnded($db, $conferenceId)) {
            throw self::error();
        }
    }
}
