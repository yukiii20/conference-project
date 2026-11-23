<?php

declare(strict_types=1);

namespace App\Validation;

use App\Core\Json;

/**
 * Base of the zod-compatible schemas. A schema parses a value into a Payload (value + issues).
 *
 * Checks run in declaration order with zod 4's rules:
 *  - a length/size check (min/max/length on strings and arrays) runs whenever the value has a length;
 *  - every other check (refine, regex, email, number bounds, overwrites like trim) is skipped once an
 *    aborting issue (invalid type, invalid enum value, non-integer) has been recorded;
 *  - check issues themselves never abort.
 */
abstract class Schema
{
    /** @var list<array{fn: callable(Payload): void, when: (callable(Payload): bool)|null}> */
    protected array $checks = [];

    /** 'optional' when a missing key may be skipped, 'defaulted' when it gets a value. */
    public ?string $optin = null;

    public ?string $optout = null;

    /** z.string({ error: '...' }): replaces the message of this schema's own type issue. */
    protected ?string $typeError = null;

    abstract protected function parseType(Payload $p): Payload;

    public function run(Payload $p): Payload
    {
        $p = $this->parseType($p);
        if ($this->checks === []) {
            return $p;
        }
        $aborted = $p->isAborted();
        foreach ($this->checks as $check) {
            if ($check['when'] !== null) {
                if ($p->aborted) {
                    continue;
                }
                if (!($check['when'])($p)) {
                    continue;
                }
            } elseif ($aborted) {
                continue;
            }
            $before = count($p->issues);
            ($check['fn'])($p);
            if (!$aborted && count($p->issues) > $before) {
                $aborted = $p->isAborted($before);
            }
        }
        return $p;
    }

    /** safeParse: ['success' => bool, 'data' => mixed, 'issues' => list]. */
    public function safeParse(mixed $value): array
    {
        $p = $this->run(new Payload($value));
        if ($p->issues !== []) {
            return ['success' => false, 'data' => null, 'issues' => array_map(self::finalize(...), $p->issues)];
        }
        return ['success' => true, 'data' => $p->value, 'issues' => []];
    }

    /** Fills in the message (custom or zod's default English text). */
    public static function finalize(array $issue): array
    {
        if (!isset($issue['message']) || $issue['message'] === null) {
            $issue['message'] = Messages::forIssue($issue);
        }
        unset($issue['input']);
        return $issue;
    }

    /** @param callable(Payload): void $fn */
    protected function addCheck(callable $fn, ?callable $when = null): static
    {
        $clone = clone $this;
        $clone->checks[] = ['fn' => $fn, 'when' => $when];
        return $clone;
    }

    protected static function whenHasLength(): callable
    {
        return static fn (Payload $p) => is_string($p->value) || (is_array($p->value) && array_is_list($p->value));
    }

    protected static function msg(string|array|null $params): ?string
    {
        if (is_array($params)) {
            return $params['message'] ?? $params['error'] ?? null;
        }
        return $params;
    }

    // ------------------------------------------------------------------ wrappers

    public function optional(): Schema
    {
        return new OptionalSchema($this);
    }

    public function nullable(): Schema
    {
        return new NullableSchema($this);
    }

    public function nullish(): Schema
    {
        return new OptionalSchema(new NullableSchema($this));
    }

    public function default(mixed $value): Schema
    {
        return new DefaultSchema($this, $value);
    }

    public function catch(mixed $value): Schema
    {
        return new CatchSchema($this, $value);
    }

    /** @param callable(mixed, Payload): mixed $fn */
    public function transform(callable $fn): Schema
    {
        return new PipeSchema($this, new TransformSchema($fn));
    }

    public function pipe(Schema $next): Schema
    {
        return new PipeSchema($this, $next);
    }

    /**
     * @param callable(mixed): bool $fn
     * @param string|array{message?: string, path?: list<string|int>, abort?: bool}|null $params
     */
    public function refine(callable $fn, string|array|null $params = null): static
    {
        $message = self::msg($params);
        $path = is_array($params) ? ($params['path'] ?? []) : [];
        $abort = is_array($params) && !empty($params['abort']);
        return $this->addCheck(static function (Payload $p) use ($fn, $message, $path, $abort): void {
            if (!$fn($p->value)) {
                $p->issues[] = ['code' => 'custom', 'message' => $message, 'path' => $path, 'continue' => !$abort];
            }
        });
    }

    /** @param callable(mixed, Payload): void $fn */
    public function superRefine(callable $fn): static
    {
        return $this->addCheck(static function (Payload $p) use ($fn): void {
            $fn($p->value, $p);
        });
    }

    /** z.preprocess(fn, schema) */
    public static function preprocess(callable $fn, Schema $schema): Schema
    {
        return new PipeSchema(new TransformSchema(static fn ($v, $p) => $fn($v, $p)), $schema);
    }

    public static function isUndef(mixed $v): bool
    {
        return Json::isUndef($v);
    }
}
