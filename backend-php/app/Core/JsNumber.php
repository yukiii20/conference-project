<?php

declare(strict_types=1);

namespace App\Core;

/** JavaScript's Number(value) conversion, used wherever the Node code (or z.coerce.number()) relied on it. */
final class JsNumber
{
    public static function from(mixed $value): float
    {
        if ($value === null) {
            return 0.0;
        }
        if (Json::isUndef($value)) {
            return NAN;
        }
        if (is_bool($value)) {
            return $value ? 1.0 : 0.0;
        }
        if (is_int($value) || is_float($value)) {
            return (float) $value;
        }
        if (is_string($value)) {
            return self::fromString($value);
        }
        if (is_array($value) && array_is_list($value)) {
            if ($value === []) {
                return 0.0;
            }
            if (count($value) === 1) {
                return self::from(JsString::from($value[0]));
            }
            return NAN;
        }
        if ($value instanceof \DateTimeInterface) {
            return (float) ((int) $value->format('Uv'));
        }
        return NAN;
    }

    public static function fromString(string $s): float
    {
        // JS StrWhiteSpaceChar: whitespace + line terminators + BOM + NBSP etc.
        $t = preg_replace('/^[\s\x{00A0}\x{FEFF}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}]+|[\s\x{00A0}\x{FEFF}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}]+$/u', '', $s);
        if ($t === null) {
            return NAN;
        }
        if ($t === '') {
            return 0.0;
        }
        if (preg_match('/^[+-]?Infinity$/', $t)) {
            return $t[0] === '-' ? -INF : INF;
        }
        if (preg_match('/^0[xX]([0-9a-fA-F]+)$/', $t, $m)) {
            return (float) hexdec($m[1]);
        }
        if (preg_match('/^0[oO]([0-7]+)$/', $t, $m)) {
            return (float) octdec($m[1]);
        }
        if (preg_match('/^0[bB]([01]+)$/', $t, $m)) {
            return (float) bindec($m[1]);
        }
        if (preg_match('/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/', $t)) {
            return (float) $t;
        }
        return NAN;
    }

    /** Number#toString for the values this app formats (integers print without ".0"). */
    public static function toString(float|int $n): string
    {
        if (is_int($n)) {
            return (string) $n;
        }
        if (is_nan($n)) {
            return 'NaN';
        }
        if (is_infinite($n)) {
            return $n > 0 ? 'Infinity' : '-Infinity';
        }
        if (floor($n) === $n && abs($n) < 1e21) {
            return number_format($n, 0, '.', '');
        }
        $s = json_encode($n);
        return str_replace(['E+', 'E-', '.0e'], ['e+', 'e-', 'e'], (string) $s);
    }
}
