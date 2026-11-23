<?php

declare(strict_types=1);

namespace App\Validation;

use App\Core\JsString;

/** z.string() and its checks. Lengths are JavaScript lengths (UTF-16 code units). */
final class StringSchema extends Schema
{
    /** zod's own email regex (zod/v4/core/regexes.js `email`). */
    public const EMAIL = '/^(?:[A-Za-z0-9_\'+\-]+\.)*[A-Za-z0-9_\'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/';

    /** zod's uuid() regex (any RFC 9562 version, plus nil and max). */
    public const UUID = '/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/';

    private const DATE_SOURCE = '(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))';

    public function __construct(?string $error = null)
    {
        $this->typeError = $error;
    }

    protected function parseType(Payload $p): Payload
    {
        if (!is_string($p->value)) {
            $p->issues[] = ['code' => 'invalid_type', 'expected' => 'string', 'input' => $p->value, 'path' => [],
                'continue' => false, 'message' => $this->typeError];
        }
        return $p;
    }

    public function min(int $n, string|array|null $message = null): self
    {
        $m = self::msg($message);
        return $this->addCheck(static function (Payload $p) use ($n, $m): void {
            if (self::len($p->value) < $n) {
                $p->issues[] = ['code' => 'too_small', 'origin' => 'string', 'minimum' => $n, 'inclusive' => true,
                    'path' => [], 'continue' => true, 'message' => $m];
            }
        }, self::whenHasLength());
    }

    public function max(int $n, string|array|null $message = null): self
    {
        $m = self::msg($message);
        return $this->addCheck(static function (Payload $p) use ($n, $m): void {
            if (self::len($p->value) > $n) {
                $p->issues[] = ['code' => 'too_big', 'origin' => 'string', 'maximum' => $n, 'inclusive' => true,
                    'path' => [], 'continue' => true, 'message' => $m];
            }
        }, self::whenHasLength());
    }

    public function length(int $n, string|array|null $message = null): self
    {
        $m = self::msg($message);
        return $this->addCheck(static function (Payload $p) use ($n, $m): void {
            $len = self::len($p->value);
            if ($len !== $n) {
                $p->issues[] = $len > $n
                    ? ['code' => 'too_big', 'origin' => 'string', 'maximum' => $n, 'inclusive' => true, 'exact' => true, 'path' => [], 'continue' => true, 'message' => $m]
                    : ['code' => 'too_small', 'origin' => 'string', 'minimum' => $n, 'inclusive' => true, 'exact' => true, 'path' => [], 'continue' => true, 'message' => $m];
            }
        }, self::whenHasLength());
    }

    /**
     * @param string $jsRegex a JavaScript regex literal, e.g. '/^[A-Z]{2}$/i' (used verbatim in the default message)
     */
    public function regex(string $jsRegex, string|array|null $message = null): self
    {
        return $this->format('regex', $jsRegex, self::msg($message), ['pattern' => $jsRegex]);
    }

    public function email(string|array|null $message = null): self
    {
        return $this->format('email', self::EMAIL, self::msg($message));
    }

    public function uuid(string|array|null $message = null): self
    {
        return $this->format('uuid', self::UUID, self::msg($message));
    }

    /** z.string().datetime({ offset?, message? }) - precision unset: seconds required, any fraction. */
    public function datetime(array|string|null $params = null): self
    {
        $offset = is_array($params) && !empty($params['offset']);
        $time = '(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?';
        $opts = 'Z' . ($offset ? '|([+-](?:[01]\d|2[0-3]):[0-5]\d)' : '');
        $re = '/^' . self::DATE_SOURCE . 'T(?:' . $time . '(?:' . $opts . '))$/';
        return $this->format('datetime', $re, self::msg($params));
    }

    public function url(string|array|null $message = null): self
    {
        $m = self::msg($message);
        return $this->addCheck(static function (Payload $p) use ($m): void {
            $ok = filter_var($p->value, FILTER_VALIDATE_URL) !== false
                && preg_match('/^[a-z][a-z0-9+.-]*:/i', (string) $p->value) === 1;
            if (!$ok) {
                $p->issues[] = ['code' => 'invalid_format', 'format' => 'url', 'path' => [], 'continue' => true, 'message' => $m];
            }
        });
    }

    public function includes(string $needle, string|array|null $message = null): self
    {
        $m = self::msg($message);
        return $this->addCheck(static function (Payload $p) use ($needle, $m): void {
            if (!str_contains($p->value, $needle)) {
                $p->issues[] = ['code' => 'invalid_format', 'format' => 'includes', 'includes' => $needle, 'path' => [], 'continue' => true, 'message' => $m];
            }
        });
    }

    public function startsWith(string $prefix, string|array|null $message = null): self
    {
        $m = self::msg($message);
        return $this->addCheck(static function (Payload $p) use ($prefix, $m): void {
            if (!str_starts_with($p->value, $prefix)) {
                $p->issues[] = ['code' => 'invalid_format', 'format' => 'starts_with', 'prefix' => $prefix, 'path' => [], 'continue' => true, 'message' => $m];
            }
        });
    }

    public function endsWith(string $suffix, string|array|null $message = null): self
    {
        $m = self::msg($message);
        return $this->addCheck(static function (Payload $p) use ($suffix, $m): void {
            if (!str_ends_with($p->value, $suffix)) {
                $p->issues[] = ['code' => 'invalid_format', 'format' => 'ends_with', 'suffix' => $suffix, 'path' => [], 'continue' => true, 'message' => $m];
            }
        });
    }

    /** JS `.length` of whatever reached a length check (zod runs them on arrays too). */
    private static function len(mixed $v): int
    {
        return is_string($v) ? JsString::length($v) : count($v);
    }

    public function trim(): self
    {
        return $this->addCheck(static function (Payload $p): void {
            $p->value = JsString::trim($p->value);
        });
    }

    public function toLowerCase(): self
    {
        return $this->addCheck(static function (Payload $p): void {
            $p->value = JsString::lower($p->value);
        });
    }

    public function toUpperCase(): self
    {
        return $this->addCheck(static function (Payload $p): void {
            $p->value = JsString::upper($p->value);
        });
    }

    private function format(string $format, string $jsRegex, ?string $message, array $extra = []): self
    {
        $pcre = self::toPcre($jsRegex);
        return $this->addCheck(static function (Payload $p) use ($pcre, $format, $message, $extra): void {
            if (preg_match($pcre, $p->value) !== 1) {
                $p->issues[] = ['code' => 'invalid_format', 'format' => $format, 'path' => [], 'continue' => true, 'message' => $message] + $extra;
            }
        });
    }

    /** '/source/flags' (JS) -> PCRE with the u modifier. */
    public static function toPcre(string $jsRegex): string
    {
        $last = strrpos($jsRegex, '/');
        $source = substr($jsRegex, 1, $last - 1);
        $flags = substr($jsRegex, $last + 1);
        $pcreFlags = 'u' . (str_contains($flags, 'i') ? 'i' : '') . (str_contains($flags, 'm') ? 'm' : '') . (str_contains($flags, 's') ? 's' : '');
        return '~' . str_replace('~', '\~', $source) . '~' . $pcreFlags;
    }
}
