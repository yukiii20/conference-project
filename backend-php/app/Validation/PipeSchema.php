<?php

declare(strict_types=1);

namespace App\Validation;

/** a.pipe(b) and a.transform(fn): b runs only if a produced no issues. */
final class PipeSchema extends Schema
{
    public function __construct(public readonly Schema $in, public readonly Schema $out)
    {
        $this->optin = $in->optin;
        $this->optout = $out->optout;
    }

    protected function parseType(Payload $p): Payload
    {
        $left = $this->in->run($p);
        foreach ($left->issues as $issue) {
            if (($issue['code'] ?? '') !== 'unrecognized_keys') {
                $left->aborted = true;
                return $left;
            }
        }
        $next = new Payload($left->value);
        $next->issues = $left->issues;
        return $this->out->run($next);
    }
}
