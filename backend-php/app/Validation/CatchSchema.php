<?php

declare(strict_types=1);

namespace App\Validation;

/** .catch(v): any failure is replaced by v and its issues dropped. */
final class CatchSchema extends Schema
{
    public function __construct(public readonly Schema $inner, private mixed $catchValue)
    {
        $this->optin = $inner->optin === 'defaulted' ? 'defaulted' : 'optional';
        $this->optout = $inner->optout;
    }

    protected function parseType(Payload $p): Payload
    {
        $r = $this->inner->run(new Payload($p->value));
        if ($r->issues !== []) {
            $p->value = is_callable($this->catchValue) && !is_string($this->catchValue) ? ($this->catchValue)($p->value) : $this->catchValue;
            return $p;
        }
        $p->value = $r->value;
        return $p;
    }
}
