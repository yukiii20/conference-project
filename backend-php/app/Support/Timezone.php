<?php

declare(strict_types=1);

namespace App\Support;

use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;

/**
 * Port of utils/timezone.ts. The algorithms are kept step for step (including the single
 * offset lookup in zonedWallTimeToUtc), so DST edge cases resolve exactly as in Node.
 * Asia/Kathmandu has no DST, so in practice it is always UTC+05:45.
 */
final class Timezone
{
    public const PLATFORM = 'Asia/Kathmandu';

    /** offsetMsAt(timeZone, utcInstant) */
    public static function offsetMsAt(string $timeZone, int $utcMs): int
    {
        $tz = new DateTimeZone($timeZone);
        return $tz->getOffset(Crypto::fromMs($utcMs)) * 1000;
    }

    /** The UTC instant of a wall-clock time in $timeZone. */
    public static function zonedWallTimeToUtc(int $y, int $m, int $d, int $h, int $i, int $s, string $timeZone): DateTimeImmutable
    {
        $guess = self::utcMs($y, $m, $d, $h, $i, $s);
        $offset = self::offsetMsAt($timeZone, $guess);
        return Crypto::fromMs($guess - $offset);
    }

    /** Date.UTC(y, m-1, d, h, i, s) with JS overflow rules (day 32 rolls into next month). */
    public static function utcMs(int $y, int $m, int $d, int $h = 0, int $i = 0, int $s = 0): int
    {
        $base = (new DateTimeImmutable('now', new DateTimeZone('UTC')))
            ->setDate($y, $m, $d)
            ->setTime($h, $i, $s);
        return $base->getTimestamp() * 1000;
    }

    /** YYYY-MM-DD of $instant in $timeZone. */
    public static function localDateKey(string $timeZone, ?DateTimeInterface $instant = null): string
    {
        $instant ??= Crypto::now();
        return DateTimeImmutable::createFromInterface($instant)->setTimezone(new DateTimeZone($timeZone))->format('Y-m-d');
    }

    /** @return array{startUtc: DateTimeImmutable, endUtc: DateTimeImmutable} */
    public static function localDateRangeToUtc(string $startDate, string $endDate, string $timeZone): array
    {
        [$sy, $sm, $sd] = array_map('intval', explode('-', $startDate));
        [$ey, $em, $ed] = array_map('intval', explode('-', $endDate));
        $startUtc = self::zonedWallTimeToUtc($sy, $sm, $sd, 0, 0, 0, $timeZone);
        $endOfDay = self::zonedWallTimeToUtc($ey, $em, $ed, 23, 59, 59, $timeZone);
        $endUtc = Crypto::fromMs(Crypto::toMs($endOfDay) + 999);
        return ['startUtc' => $startUtc, 'endUtc' => $endUtc];
    }

    public static function addDaysToDateKey(string $dateKey, int $days): string
    {
        [$y, $m, $d] = array_map('intval', explode('-', $dateKey));
        return gmdate('Y-m-d', intdiv(self::utcMs($y, $m, $d + $days), 1000));
    }

    /** The Sunday starting the week of $dateKey. */
    public static function weekStartKey(string $dateKey): string
    {
        [$y, $m, $d] = array_map('intval', explode('-', $dateKey));
        $dow = (int) gmdate('w', intdiv(self::utcMs($y, $m, $d), 1000));
        return self::addDaysToDateKey($dateKey, -$dow);
    }
}
