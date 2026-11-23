<?php

declare(strict_types=1);

namespace App\Http;

/**
 * Express 4 parses the query string with `qs`. PHP's parse_str differs: a repeated key keeps
 * only its last value and dots/spaces in names become underscores. The frontend only sends
 * flat key=value pairs (src/lib/api.ts buildUrl), so this covers the qs rules that matter:
 *   - repeated keys become a list:        a=1&a=2      -> ['a' => ['1','2']]
 *   - bracket lists and nested keys:      a[]=1, a[0]=1 -> list;  a[b]=c -> ['a' => ['b' => 'c']]
 *   - '+' is a space, values are percent-decoded, at most 1000 parameters, depth 5.
 */
final class QueryString
{
    /** @return array<string,mixed> */
    public static function parse(string $query): array
    {
        $result = [];
        if ($query === '') {
            return $result;
        }
        foreach (array_slice(explode('&', $query), 0, 1000) as $part) {
            if ($part === '') {
                continue;
            }
            $bracketEq = strpos($part, ']=');
            $pos = $bracketEq === false ? strpos($part, '=') : $bracketEq + 1;
            $key = self::decode($pos === false ? $part : substr($part, 0, $pos));
            $val = $pos === false ? '' : self::decode(substr($part, $pos + 1));
            if ($key === '') {
                continue;
            }
            $path = self::keyPath($key);
            self::assign($result, $path, $val);
        }
        return $result;
    }

    private static function decode(string $s): string
    {
        $d = rawurldecode(str_replace('+', ' ', $s));
        return mb_check_encoding($d, 'UTF-8') ? $d : $s;
    }

    /** "a[b][]" -> ['a', 'b', ''] (at most 5 bracket levels, the rest stays literal). */
    private static function keyPath(string $key): array
    {
        $open = strpos($key, '[');
        if ($open === false || $open === 0 || !str_contains($key, ']')) {
            return [$key];
        }
        $path = [substr($key, 0, $open)];
        $rest = substr($key, $open);
        $depth = 0;
        while ($rest !== '' && $depth < 5 && preg_match('/^\[([^[\]]*)]/', $rest, $m)) {
            $path[] = $m[1];
            $rest = substr($rest, strlen($m[0]));
            $depth++;
        }
        if ($rest !== '') {
            $path[] = $rest;
        }
        return $path;
    }

    private static function assign(array &$target, array $path, string $val): void
    {
        $key = array_shift($path);
        if ($path === []) {
            if (!array_key_exists($key, $target)) {
                $target[$key] = $val;
            } elseif (is_array($target[$key]) && array_is_list($target[$key])) {
                $target[$key][] = $val;
            } elseif (is_array($target[$key])) {
                // qs merges a plain value into an object as the next numeric key; rare, keep it simple.
                $target[$key][] = $val;
            } else {
                $target[$key] = [$target[$key], $val];
            }
            return;
        }
        $next = $path[0];
        if (!isset($target[$key]) || !is_array($target[$key])) {
            $existing = $target[$key] ?? null;
            $target[$key] = $existing === null ? [] : [$existing];
        }
        if ($next === '' && count($path) === 1) {
            $target[$key][] = $val;
            return;
        }
        if (ctype_digit($next) && (int) $next <= 20 && count($path) === 1 && array_is_list($target[$key])) {
            $target[$key][(int) $next] = $val;
            ksort($target[$key]);
            $target[$key] = array_values($target[$key]);
            return;
        }
        self::assign($target[$key], $path, $val);
    }
}
