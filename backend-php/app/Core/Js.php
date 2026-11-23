<?php

declare(strict_types=1);

namespace App\Core;

/** Small JavaScript semantics helpers used by ported code. */
final class Js
{
    /** JS truthiness: false, 0, NaN, '', null, undefined are falsy; '0', [] and {} are truthy. */
    public static function truthy(mixed $v): bool
    {
        if ($v === null || $v === false || $v === '' || $v === 0 || Json::isUndef($v)) {
            return false;
        }
        if (is_float($v)) {
            return $v !== 0.0 && !is_nan($v);
        }
        return true;
    }
}
