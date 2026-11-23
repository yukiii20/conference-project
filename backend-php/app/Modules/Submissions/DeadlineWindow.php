<?php

declare(strict_types=1);

namespace App\Modules\Submissions;

use App\Db\Db;
use App\Support\Crypto;

/** loadDeadlineWindow / isWindowOpen from modules/submissions/service.ts. */
final class DeadlineWindow
{
    /** @return array{opens_at: ?\DateTimeImmutable, closes_at: ?\DateTimeImmutable, grace_minutes: int}|null */
    public static function load(string $conferenceId, string $deadlineType): ?array
    {
        return Db::pool()->first(
            'SELECT opens_at, closes_at, grace_minutes FROM conference_deadlines WHERE conference_id = ? AND deadline_type = ? LIMIT 1',
            [$conferenceId, $deadlineType],
        );
    }

    public static function isOpen(?array $window, ?int $nowMs = null): bool
    {
        $nowMs ??= Crypto::nowMs();
        if ($window === null || $window['opens_at'] === null) {
            return false;
        }
        if ($nowMs < Crypto::toMs($window['opens_at'])) {
            return false;
        }
        if ($window['closes_at'] !== null) {
            $graceMs = (int) ($window['grace_minutes'] ?? 0) * 60000;
            if ($nowMs > Crypto::toMs($window['closes_at']) + $graceMs) {
                return false;
            }
        }
        return true;
    }
}
