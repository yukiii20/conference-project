<?php

declare(strict_types=1);

namespace App\Validation;

use App\Http\JsonObject;

/**
 * z.object(shape): unknown keys are stripped; output keys follow the shape order.
 * Absent keys follow zod 4's handlePropertyResult rules exactly (optional keys stay absent,
 * defaults fill in, `.optional().transform(fn)` still produces fn(undefined)).
 * The output is a plain PHP assoc array.
 */
final class ObjectSchema extends Schema
{
    /** @param array<string, Schema> $shape */
    public function __construct(public readonly array $shape, ?string $error = null)
    {
        $this->typeError = $error;
    }

    public static function isObject(mixed $v): bool
    {
        return $v instanceof JsonObject || $v instanceof \stdClass
            || (is_array($v) && $v !== [] && !array_is_list($v));
    }

    protected function parseType(Payload $p): Payload
    {
        $input = $p->value;
        if (!self::isObject($input)) {
            $p->issues[] = ['code' => 'invalid_type', 'expected' => 'object', 'input' => $input, 'path' => [],
                'continue' => false, 'message' => $this->typeError];
            return $p;
        }
        if ($input instanceof \stdClass) {
            $input = get_object_vars($input);
        }
        $out = [];
        foreach ($this->shape as $key => $schema) {
            $present = $input instanceof JsonObject ? $input->offsetExists($key) : array_key_exists($key, $input);
            $value = $present ? $input[$key] : self::undefined();
            $r = $schema->run(new Payload($value));
            $optin = $schema->optin;
            $optionalOut = $schema->optout === 'optional';

            if (!$present && $optionalOut && $optin === 'optional') {
                continue;
            }
            if ($r->issues !== []) {
                if ($optin !== null && $optionalOut && !$present) {
                    continue;
                }
                foreach ($r->issues as $issue) {
                    $issue['path'] = [$key, ...($issue['path'] ?? [])];
                    $p->issues[] = $issue;
                }
            }
            if (!$present && $optin === null) {
                if ($r->issues === []) {
                    $p->issues[] = ['code' => 'invalid_type', 'expected' => 'nonoptional', 'input' => self::undefined(),
                        'path' => [$key], 'continue' => false, 'message' => null];
                }
                continue;
            }
            if (self::isUndef($r->value)) {
                // A JS property explicitly set to undefined is dropped by JSON.stringify and behaves like
                // an absent key everywhere this app reads it, so it is simply left out.
                continue;
            }
            $out[$key] = $r->value;
        }
        $p->value = $out;
        return $p;
    }

    /** schema.pick({ a: true, b: true }) */
    public function pick(array $keys): self
    {
        $shape = [];
        foreach ($keys as $k) {
            if (isset($this->shape[$k])) {
                $shape[$k] = $this->shape[$k];
            }
        }
        return new self($shape, $this->typeError);
    }

    /** schema.extend({ ... }) */
    public function extend(array $shape): self
    {
        return new self(array_merge($this->shape, $shape), $this->typeError);
    }

    public function partial(): self
    {
        return new self(array_map(static fn (Schema $s) => $s->optional(), $this->shape), $this->typeError);
    }

    private static function undefined(): \stdClass
    {
        return \App\Core\Json::undef();
    }
}
