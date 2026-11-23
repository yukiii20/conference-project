<?php

declare(strict_types=1);

namespace App\Support;

/** Port of utils/phone.ts: Nepal mobile numbers, normalised to +97798XXXXXXXX. */
final class Phone
{
    public static function normalize(string $raw): ?string
    {
        $digits = preg_replace('/[\s-]/u', '', \App\Core\JsString::trim($raw)) ?? '';
        $digits = preg_replace('/^\+/', '', $digits) ?? '';
        if (str_starts_with($digits, '977')) {
            $digits = substr($digits, 3);
        }
        if (preg_match('/^(97|98)\d{8}$/', $digits)) {
            return '+977' . $digits;
        }
        return null;
    }
}
