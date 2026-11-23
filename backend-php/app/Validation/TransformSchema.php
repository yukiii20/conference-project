<?php

declare(strict_types=1);

namespace App\Validation;

/** z.transform(fn): fn(value, ctx) may call $ctx->addIssue(). */
final class TransformSchema extends Schema
{
    /** @var callable(mixed, Payload): mixed */
    private $fn;

    public function __construct(callable $fn)
    {
        $this->fn = $fn;
        $this->optin = 'optional';
    }

    protected function parseType(Payload $p): Payload
    {
        $p->issuesContinue = false;
        try {
            $p->value = ($this->fn)($p->value, $p);
        } finally {
            $p->issuesContinue = true;
        }
        return $p;
    }
}
