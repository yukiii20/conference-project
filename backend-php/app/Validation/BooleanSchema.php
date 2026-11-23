<?php

declare(strict_types=1);

namespace App\Validation;

/** z.boolean() */
final class BooleanSchema extends Schema
{
    public function __construct(?string $error = null)
    {
        $this->typeError = $error;
    }

    protected function parseType(Payload $p): Payload
    {
        if (!is_bool($p->value)) {
            $p->issues[] = ['code' => 'invalid_type', 'expected' => 'boolean', 'input' => $p->value, 'path' => [],
                'continue' => false, 'message' => $this->typeError];
        }
        return $p;
    }
}
