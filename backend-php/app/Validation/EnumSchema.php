<?php

declare(strict_types=1);

namespace App\Validation;

/** z.enum([...]) and z.literal(v) (a one-value enum gives "Invalid input: expected ..."). */
final class EnumSchema extends Schema
{
    /** @param list<string|int|bool|null> $values */
    public function __construct(public readonly array $values, ?string $error = null)
    {
        $this->typeError = $error;
    }

    protected function parseType(Payload $p): Payload
    {
        if (!in_array($p->value, $this->values, true)) {
            $p->issues[] = ['code' => 'invalid_value', 'values' => $this->values, 'input' => $p->value, 'path' => [],
                'continue' => false, 'message' => $this->typeError];
        }
        return $p;
    }
}
