<?php

declare(strict_types=1);

namespace App\Validation;

/** .nullable(): null passes as-is. */
final class NullableSchema extends Schema
{
    public function __construct(public readonly Schema $inner)
    {
        $this->optin = $inner->optin;
        $this->optout = $inner->optout;
    }

    protected function parseType(Payload $p): Payload
    {
        if ($p->value === null) {
            return $p;
        }
        return $this->inner->run($p);
    }
}
