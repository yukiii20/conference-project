<?php

declare(strict_types=1);

namespace App\Validation;

/** z.array(item) */
final class ArraySchema extends Schema
{
    public function __construct(public readonly Schema $item, ?string $error = null)
    {
        $this->typeError = $error;
    }

    protected function parseType(Payload $p): Payload
    {
        if (Messages::parsedType($p->value) !== 'array') {
            $p->issues[] = ['code' => 'invalid_type', 'expected' => 'array', 'input' => $p->value, 'path' => [],
                'continue' => false, 'message' => $this->typeError];
            return $p;
        }
        $out = [];
        foreach ($p->value as $i => $v) {
            $r = $this->item->run(new Payload($v));
            foreach ($r->issues as $issue) {
                $issue['path'] = [$i, ...($issue['path'] ?? [])];
                $p->issues[] = $issue;
            }
            $out[] = self::isUndef($r->value) ? null : $r->value;
        }
        $p->value = $out;
        return $p;
    }

    public function min(int $n, string|array|null $message = null): self
    {
        return $this->size('too_small', $n, false, self::msg($message));
    }

    public function max(int $n, string|array|null $message = null): self
    {
        return $this->size('too_big', $n, false, self::msg($message));
    }

    public function length(int $n, string|array|null $message = null): self
    {
        return $this->size('exact', $n, true, self::msg($message));
    }

    public function nonempty(string|array|null $message = null): self
    {
        return $this->min(1, $message);
    }

    private function size(string $kind, int $n, bool $exact, ?string $m): self
    {
        return $this->addCheck(static function (Payload $p) use ($kind, $n, $exact, $m): void {
            $c = count($p->value);
            $code = null;
            if ($kind === 'too_small' && $c < $n) {
                $code = 'too_small';
            } elseif ($kind === 'too_big' && $c > $n) {
                $code = 'too_big';
            } elseif ($kind === 'exact' && $c !== $n) {
                $code = $c > $n ? 'too_big' : 'too_small';
            }
            if ($code === null) {
                return;
            }
            $issue = ['code' => $code, 'origin' => 'array', 'inclusive' => true, 'path' => [], 'continue' => true, 'message' => $m];
            if ($exact) {
                $issue['exact'] = true;
            }
            $issue[$code === 'too_small' ? 'minimum' : 'maximum'] = $n;
            $p->issues[] = $issue;
        }, self::whenHasLength());
    }
}
