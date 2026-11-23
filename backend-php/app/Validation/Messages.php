<?php

declare(strict_types=1);

namespace App\Validation;

use App\Core\JsNumber;
use App\Core\Json;
use App\Http\JsonObject;

/** zod 4's English locale (zod/v4/locales/en.js), word for word. */
final class Messages
{
    private const SIZABLE = ['string' => 'characters', 'file' => 'bytes', 'array' => 'items', 'set' => 'items', 'map' => 'entries'];

    private const FORMATS = [
        'regex' => 'input', 'email' => 'email address', 'url' => 'URL', 'emoji' => 'emoji', 'uuid' => 'UUID',
        'uuidv4' => 'UUIDv4', 'uuidv6' => 'UUIDv6', 'nanoid' => 'nanoid', 'guid' => 'GUID', 'cuid' => 'cuid',
        'cuid2' => 'cuid2', 'ulid' => 'ULID', 'xid' => 'XID', 'ksuid' => 'KSUID', 'datetime' => 'ISO datetime',
        'date' => 'ISO date', 'time' => 'ISO time', 'duration' => 'ISO duration', 'ipv4' => 'IPv4 address',
        'ipv6' => 'IPv6 address', 'base64' => 'base64-encoded string', 'base64url' => 'base64url-encoded string',
        'json_string' => 'JSON string', 'e164' => 'E.164 number', 'jwt' => 'JWT', 'template_literal' => 'input',
    ];

    public static function forIssue(array $issue): string
    {
        switch ($issue['code']) {
            case 'invalid_type':
                $expected = self::typeName((string) $issue['expected'], null);
                $input = array_key_exists('input', $issue) ? $issue['input'] : Json::undef();
                $received = self::typeName(self::parsedType($input), $input);
                return "Invalid input: expected {$expected}, received {$received}";
            case 'invalid_value':
                $values = $issue['values'];
                if (count($values) === 1) {
                    return 'Invalid input: expected ' . self::stringifyPrimitive($values[0]);
                }
                return 'Invalid option: expected one of ' . implode('|', array_map(self::stringifyPrimitive(...), $values));
            case 'too_big':
                $adj = !empty($issue['exact']) ? 'exactly ' : (!empty($issue['inclusive']) ? '<=' : '<');
                $origin = $issue['origin'] ?? 'value';
                $unit = self::SIZABLE[$origin] ?? null;
                $max = JsNumber::toString($issue['maximum']);
                return $unit !== null
                    ? "Too big: expected {$origin} to have {$adj}{$max} {$unit}"
                    : "Too big: expected {$origin} to be {$adj}{$max}";
            case 'too_small':
                $adj = !empty($issue['exact']) ? 'exactly ' : (!empty($issue['inclusive']) ? '>=' : '>');
                $origin = $issue['origin'] ?? 'value';
                $unit = self::SIZABLE[$origin] ?? null;
                $min = JsNumber::toString($issue['minimum']);
                return $unit !== null
                    ? "Too small: expected {$origin} to have {$adj}{$min} {$unit}"
                    : "Too small: expected {$origin} to be {$adj}{$min}";
            case 'invalid_format':
                $format = $issue['format'];
                return match ($format) {
                    'starts_with' => 'Invalid string: must start with "' . $issue['prefix'] . '"',
                    'ends_with' => 'Invalid string: must end with "' . $issue['suffix'] . '"',
                    'includes' => 'Invalid string: must include "' . $issue['includes'] . '"',
                    'regex' => 'Invalid string: must match pattern ' . $issue['pattern'],
                    default => 'Invalid ' . (self::FORMATS[$format] ?? $format),
                };
            case 'not_multiple_of':
                return 'Invalid number: must be a multiple of ' . $issue['divisor'];
            case 'invalid_union':
                return 'Invalid input';
            case 'invalid_element':
                return 'Invalid value in ' . $issue['origin'];
            default:
                return 'Invalid input';
        }
    }

    private static function typeName(string $type, mixed $input): string
    {
        if ($type === 'number' && (is_float($input)) && !is_finite($input)) {
            return JsNumber::toString($input);
        }
        return $type === 'nan' ? 'NaN' : $type;
    }

    /** zod util.parsedType for PHP values (JSON-decoded bodies, qs-parsed queries). */
    public static function parsedType(mixed $v): string
    {
        if (Json::isUndef($v)) {
            return 'undefined';
        }
        return match (true) {
            $v === null => 'null',
            is_string($v) => 'string',
            is_bool($v) => 'boolean',
            is_int($v) => 'number',
            is_float($v) => is_nan($v) ? 'nan' : 'number',
            $v instanceof \DateTimeInterface => 'date',
            is_array($v) && array_is_list($v) && !($v instanceof JsonObject) => 'array',
            default => 'object',
        };
    }

    /** util.stringifyPrimitive: strings in double quotes, everything else String(v). */
    public static function stringifyPrimitive(mixed $v): string
    {
        if (is_string($v)) {
            return json_encode($v, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        }
        if (is_bool($v)) {
            return $v ? 'true' : 'false';
        }
        if ($v === null) {
            return 'null';
        }
        return JsNumber::toString($v);
    }
}
