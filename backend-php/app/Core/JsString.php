<?php

declare(strict_types=1);

namespace App\Core;

/** JavaScript String(value) / template-literal conversion, plus UTF-16 length (JS string .length). */
final class JsString
{
    public static function from(mixed $value): string
    {
        if ($value === null) {
            return 'null';
        }
        if (Json::isUndef($value)) {
            return 'undefined';
        }
        if (is_bool($value)) {
            return $value ? 'true' : 'false';
        }
        if (is_string($value)) {
            return $value;
        }
        if (is_int($value) || is_float($value)) {
            return JsNumber::toString($value);
        }
        if ($value instanceof \DateTimeInterface) {
            // Date#toString is locale/timezone dependent; the Node code never relied on it.
            return Json::isoDate($value);
        }
        if (is_array($value) && array_is_list($value)) {
            return implode(',', array_map(static fn ($v) => $v === null || Json::isUndef($v) ? '' : self::from($v), $value));
        }
        return '[object Object]';
    }

    /** JS .length: UTF-16 code units. */
    public static function length(string $s): int
    {
        $len = 0;
        $n = strlen($s);
        for ($i = 0; $i < $n; $i++) {
            $c = ord($s[$i]);
            if ($c < 0x80 || $c >= 0xC0) {
                $len += $c >= 0xF0 ? 2 : 1;
            }
        }
        return $len;
    }

    /** String#slice(0, n) on UTF-16 units (never splits a code point). */
    public static function slice(string $s, int $start, ?int $end = null): string
    {
        $chars = mb_str_split($s);
        $out = '';
        $pos = 0;
        foreach ($chars as $ch) {
            $w = strlen($ch) >= 4 ? 2 : 1;
            if ($pos >= $start && ($end === null || $pos + $w <= $end)) {
                $out .= $ch;
            }
            $pos += $w;
            if ($end !== null && $pos >= $end) {
                break;
            }
        }
        return $out;
    }

    /** String#trim (JS whitespace set). */
    public static function trim(string $s): string
    {
        $ws = '[\s\x{00A0}\x{FEFF}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}]';
        return (string) preg_replace("/^{$ws}+|{$ws}+$/u", '', $s);
    }

    public static function lower(string $s): string
    {
        return mb_strtolower($s, 'UTF-8');
    }

    public static function upper(string $s): string
    {
        return mb_strtoupper($s, 'UTF-8');
    }
}
