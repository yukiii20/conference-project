<?php

declare(strict_types=1);

namespace App\Validation;

/** .optional(): a missing value (undefined) passes without running the inner schema (unless it has a default). */
final class OptionalSchema extends Schema
{
    public function __construct(public readonly Schema $inner)
    {
        $this->optin = $inner->optin === 'defaulted' ? 'defaulted' : 'optional';
        $this->optout = 'optional';
    }

    protected function parseType(Payload $p): Payload
    {
        if (self::isUndef($p->value)) {
            if ($this->inner->optin !== 'defaulted') {
                return $p;
            }
            $r = $this->inner->run(new Payload($p->value));
            $p->value = $r->issues !== [] ? $p->value : $r->value;
            return $p;
        }
        return $this->inner->run($p);
    }
}
