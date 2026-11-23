<?php

declare(strict_types=1);

namespace App\Validation;

/** zod's ParsePayload: the value being parsed plus the issues found so far. */
final class Payload
{
    /** @var list<array<string,mixed>> */
    public array $issues = [];

    public bool $aborted = false;

    /** False while a transform runs: zod leaves `continue` unset there, so its issues abort. */
    public bool $issuesContinue = true;

    public function __construct(public mixed $value)
    {
    }

    /** util.aborted(): any issue that does not allow continuing (since $from). */
    public function isAborted(int $from = 0): bool
    {
        if ($this->aborted) {
            return true;
        }
        for ($i = $from, $n = count($this->issues); $i < $n; $i++) {
            if (($this->issues[$i]['continue'] ?? false) !== true) {
                return true;
            }
        }
        return false;
    }

    /** ctx.addIssue() inside refine/superRefine/transform. */
    public function addIssue(array|string $issue): void
    {
        if (is_string($issue)) {
            $issue = ['code' => 'custom', 'message' => $issue];
        }
        $issue['code'] ??= 'custom';
        $issue['path'] ??= [];
        if (!empty($issue['fatal'])) {
            $issue['continue'] = false;
        }
        if ($this->issuesContinue) {
            $issue['continue'] ??= true;
        }
        $this->issues[] = $issue;
    }
}
