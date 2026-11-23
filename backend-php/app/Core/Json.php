<?php

declare(strict_types=1);

namespace App\Core;

use DateTimeInterface;
use DateTimeZone;
use JsonSerializable;
use stdClass;

/**
 * JSON encoding that matches what Express's res.json() (JSON.stringify) produced for the
 * values mysql2 returned:
 *  - DATETIME/TIMESTAMP values (DateTimeInterface) become "2026-11-23T04:15:00.000Z".
 *  - A float with no fraction prints as 5, never 5.0. NaN/Infinity print as null.
 *  - Slashes and non-ASCII characters are not escaped (JSON.stringify doesn't).
 *  - Json::undef() as an array value drops the key, like a JS `undefined` property.
 *  - An empty PHP array is [], so object maps that may be empty must be stdClass / Json::obj().
 */
final class Json
{
    private static ?stdClass $undef = null;

    public const FLAGS = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_LINE_TERMINATORS
        | JSON_INVALID_UTF8_SUBSTITUTE;

    /** The JS `undefined` sentinel: dropped from objects, null inside arrays (like JSON.stringify). */
    public static function undef(): stdClass
    {
        return self::$undef ??= new stdClass();
    }

    public static function isUndef(mixed $v): bool
    {
        return $v === self::$undef && $v !== null;
    }

    /** An object map that stays `{}` when empty. */
    public static function obj(array $values = []): stdClass
    {
        return (object) $values;
    }

    public static function encode(mixed $value): string
    {
        $prepared = self::prepare($value);
        $json = json_encode($prepared, self::FLAGS);
        if ($json === false) {
            throw new \RuntimeException('JSON encoding failed: ' . json_last_error_msg());
        }
        return $json;
    }

    /** Converts a value into plain arrays/stdClass/scalars ready for json_encode. */
    public static function prepare(mixed $value): mixed
    {
        if ($value === null || is_string($value) || is_bool($value) || is_int($value)) {
            return $value;
        }
        if (is_float($value)) {
            if (is_nan($value) || is_infinite($value)) {
                return null;
            }
            if (floor($value) === $value && abs($value) < 9007199254740992) {
                return (int) $value;
            }
            return $value;
        }
        if ($value instanceof DateTimeInterface) {
            return self::isoDate($value);
        }
        if ($value instanceof JsonSerializable) {
            return self::prepare($value->jsonSerialize());
        }
        if (is_array($value)) {
            if (array_is_list($value)) {
                $out = [];
                foreach ($value as $item) {
                    $out[] = self::isUndef($item) ? null : self::prepare($item);
                }
                return $out;
            }
            $out = new stdClass();
            foreach ($value as $k => $item) {
                if (self::isUndef($item)) {
                    continue;
                }
                $out->{(string) $k} = self::prepare($item);
            }
            return $out;
        }
        if ($value instanceof stdClass || $value instanceof \ArrayObject) {
            $out = new stdClass();
            foreach ((array) $value as $k => $item) {
                if (self::isUndef($item)) {
                    continue;
                }
                $out->{(string) $k} = self::prepare($item);
            }
            return $out;
        }
        if (is_object($value)) {
            return self::prepare(get_object_vars($value));
        }
        return null;
    }

    public static function isoDate(DateTimeInterface $d): string
    {
        $utc = \DateTimeImmutable::createFromInterface($d)->setTimezone(new DateTimeZone('UTC'));
        return $utc->format('Y-m-d\TH:i:s.v\Z');
    }

    /** JSON.parse equivalent that keeps objects as stdClass (so {} stays {}). */
    public static function decode(string $json): mixed
    {
        return json_decode($json, false, 512, JSON_THROW_ON_ERROR);
    }
}
