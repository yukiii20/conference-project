<?php

declare(strict_types=1);

namespace App\Http;

/**
 * A parsed JSON object from a request body. Behaves like an assoc array but remembers that
 * it was `{...}` (so z.object() can reject `[...]`, and an empty one encodes back as `{}`).
 *
 * @extends \ArrayObject<string, mixed>
 */
final class JsonObject extends \ArrayObject
{
    public function toArray(): array
    {
        $out = [];
        foreach ($this as $k => $v) {
            $out[$k] = $v instanceof self ? $v->toArray() : (is_array($v) ? array_map(
                static fn ($x) => $x instanceof self ? $x->toArray() : $x,
                $v,
            ) : $v);
        }
        return $out;
    }
}
