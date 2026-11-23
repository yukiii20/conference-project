<?php

declare(strict_types=1);

namespace App\Validation;

/** z.union([...]): the first option without issues wins. */
final class UnionSchema extends Schema
{
    /** @param list<Schema> $options */
    public function __construct(public readonly array $options)
    {
        foreach ($options as $o) {
            if ($o->optin === 'defaulted') {
                $this->optin = 'defaulted';
                break;
            }
            if ($o->optin !== null) {
                $this->optin = 'optional';
            }
        }
        foreach ($options as $o) {
            if ($o->optout === 'optional') {
                $this->optout = 'optional';
            }
        }
    }

    protected function parseType(Payload $p): Payload
    {
        $results = [];
        foreach ($this->options as $option) {
            $r = $option->run(new Payload($p->value));
            if ($r->issues === []) {
                $p->value = $r->value;
                return $p;
            }
            $results[] = $r;
        }
        $nonAborted = array_values(array_filter($results, static fn (Payload $r) => !$r->isAborted()));
        if (count($nonAborted) === 1) {
            $p->value = $nonAborted[0]->value;
            array_push($p->issues, ...$nonAborted[0]->issues);
            return $p;
        }
        $p->issues[] = ['code' => 'invalid_union', 'path' => [], 'continue' => false, 'message' => null];
        return $p;
    }
}
