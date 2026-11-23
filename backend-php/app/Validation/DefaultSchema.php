<?php

declare(strict_types=1);

namespace App\Validation;

/** .default(v): undefined becomes v WITHOUT validating it (zod 4). */
final class DefaultSchema extends Schema
{
    public function __construct(public readonly Schema $inner, private mixed $defaultValue)
    {
        $this->optin = 'defaulted';
    }

    protected function parseType(Payload $p): Payload
    {
        if (self::isUndef($p->value)) {
            $p->value = is_callable($this->defaultValue) && !is_string($this->defaultValue) ? ($this->defaultValue)() : $this->defaultValue;
            return $p;
        }
        $r = $this->inner->run($p);
        if (self::isUndef($r->value)) {
            $r->value = $this->defaultValue;
        }
        return $r;
    }
}
