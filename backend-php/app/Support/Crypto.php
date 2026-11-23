<?php

declare(strict_types=1);

namespace App\Support;

use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;

/** Port of utils/crypto.ts plus the Date.now()-style helpers the services use. */
final class Crypto
{
    /** 32 random bytes, hex (64 chars): session and reset tokens. */
    public static function generateToken(): string
    {
        return bin2hex(random_bytes(32));
    }

    public static function sha256(string $value): string
    {
        return hash('sha256', $value);
    }

    /** A random URL-safe token of exactly $length characters (qr_token, verification_token). */
    public static function generateUrlSafeToken(int $length): string
    {
        $token = '';
        while (strlen($token) < $length) {
            $token .= rtrim(strtr(base64_encode(random_bytes($length)), '+/', '-_'), '=');
        }
        return substr($token, 0, $length);
    }

    public static function uuid(): string
    {
        $b = random_bytes(16);
        $b[6] = chr((ord($b[6]) & 0x0f) | 0x40);
        $b[8] = chr((ord($b[8]) & 0x3f) | 0x80);
        $h = bin2hex($b);
        return substr($h, 0, 8) . '-' . substr($h, 8, 4) . '-' . substr($h, 12, 4) . '-' . substr($h, 16, 4) . '-' . substr($h, 20);
    }

    /** Date.now() */
    public static function nowMs(): int
    {
        return (int) floor(microtime(true) * 1000);
    }

    /** new Date() (millisecond precision, UTC) */
    public static function now(): DateTimeImmutable
    {
        return self::fromMs(self::nowMs());
    }

    /** new Date(Date.now() + ms) */
    public static function nowPlusMs(int $ms): DateTimeImmutable
    {
        return self::fromMs(self::nowMs() + $ms);
    }

    public static function fromMs(int $ms): DateTimeImmutable
    {
        $sec = intdiv($ms, 1000);
        $milli = $ms - $sec * 1000;
        if ($milli < 0) {
            $sec -= 1;
            $milli += 1000;
        }
        $d = DateTimeImmutable::createFromFormat('U.v', sprintf('%d.%03d', $sec, $milli), new DateTimeZone('UTC'));
        return $d->setTimezone(new DateTimeZone('UTC'));
    }

    /** new Date(value).getTime() for a DB value (DateTime or string). */
    public static function toMs(DateTimeInterface|string|null $value): int
    {
        if ($value === null) {
            return 0;
        }
        if (is_string($value)) {
            $value = new DateTimeImmutable($value, new DateTimeZone('UTC'));
        }
        return (int) $value->format('Uv');
    }

    public static function timingSafeEqual(string $a, string $b): bool
    {
        return strlen($a) === strlen($b) && hash_equals($a, $b);
    }
}
