<?php

declare(strict_types=1);

namespace App\Validation;

/** z.any() / z.unknown() */
final class AnySchema extends Schema
{
    public function __construct()
    {
        $this->optin = 'optional';
        $this->optout = 'optional';
    }

    protected function parseType(Payload $p): Payload
    {
        return $p;
    }
}
