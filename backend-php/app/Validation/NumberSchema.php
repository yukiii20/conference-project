<?php

declare(strict_types=1);

namespace App\Validation;

use App\Core\JsNumber;

/** z.number() / z.coerce.number() and their checks. */
final class NumberSchema extends Schema
{
    public function __construct(private bool $coerce = false, ?string $error = null)
    {
        $this->typeError = $error;
    }

    protected function parseType(Payload $p): Payload
    {
        if ($this->coerce) {
            $p->value = JsNumber::from($p->value);
        }
        $v = $p->value;
        if ((is_int($v) || is_float($v)) && is_finite((float) $v)) {
            if (is_float($v) && floor($v) === $v && abs($v) <= 9007199254740991) {
                $p->value = (int) $v;
            }
            return $p;
        }
        $p->issues[] = ['code' => 'invalid_type', 'expected' => 'number', 'input' => $v, 'path' => [],
            'continue' => false, 'message' => $this->typeError];
        return $p;
    }

    public function int(string|array|null $message = null): self
    {
        $m = self::msg($message);
        return $this->addCheck(static function (Payload $p) use ($m): void {
            $v = $p->value;
            if (!is_int($v)) {
                $p->issues[] = ['code' => 'invalid_type', 'expected' => 'int', 'format' => 'safeint', 'input' => $v,
                    'path' => [], 'continue' => false, 'message' => $m];
                return;
            }
            if ($v > 9007199254740991) {
                $p->issues[] = ['code' => 'too_big', 'origin' => 'int', 'maximum' => 9007199254740991, 'inclusive' => true, 'path' => [], 'continue' => true, 'message' => $m];
            } elseif ($v < -9007199254740991) {
                $p->issues[] = ['code' => 'too_small', 'origin' => 'int', 'minimum' => -9007199254740991, 'inclusive' => true, 'path' => [], 'continue' => true, 'message' => $m];
            }
        });
    }

    public function min(int|float $n, string|array|null $message = null): self
    {
        return $this->bound('too_small', $n, true, self::msg($message));
    }

    public function gte(int|float $n, string|array|null $message = null): self
    {
        return $this->min($n, $message);
    }

    public function gt(int|float $n, string|array|null $message = null): self
    {
        return $this->bound('too_small', $n, false, self::msg($message));
    }

    public function positive(string|array|null $message = null): self
    {
        return $this->gt(0, $message);
    }

    public function nonnegative(string|array|null $message = null): self
    {
        return $this->min(0, $message);
    }

    public function max(int|float $n, string|array|null $message = null): self
    {
        return $this->bound('too_big', $n, true, self::msg($message));
    }

    public function lte(int|float $n, string|array|null $message = null): self
    {
        return $this->max($n, $message);
    }

    public function lt(int|float $n, string|array|null $message = null): self
    {
        return $this->bound('too_big', $n, false, self::msg($message));
    }

    private function bound(string $code, int|float $n, bool $inclusive, ?string $m): self
    {
        return $this->addCheck(static function (Payload $p) use ($code, $n, $inclusive, $m): void {
            $v = $p->value;
            $fail = $code === 'too_small'
                ? ($inclusive ? $v < $n : $v <= $n)
                : ($inclusive ? $v > $n : $v >= $n);
            if ($fail) {
                $issue = ['code' => $code, 'origin' => 'number', 'inclusive' => $inclusive, 'path' => [], 'continue' => true, 'message' => $m];
                $issue[$code === 'too_small' ? 'minimum' : 'maximum'] = $n;
                $p->issues[] = $issue;
            }
        });
    }
}
