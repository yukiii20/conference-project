<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Db\Db;
use App\Http\Req;
use App\Support\ConferenceEnded;

/** Port of middleware/conferenceEnded.ts: 409 conference_ended once the conference is over. */
final class ConferenceEndedGuard
{
    /** @param callable(Req): ?string $resolve */
    private static function refuseWhenEnded(callable $resolve): \Closure
    {
        return static function (Req $req, callable $next) use ($resolve) {
            $conferenceId = $resolve($req);
            if (\App\Core\Js::truthy($conferenceId)) {
                ConferenceEnded::assertNotEnded(Db::pool(), $conferenceId);
            }
            return $next($req);
        };
    }

    private static function single(string $sql, ?string $param): ?string
    {
        if (!\App\Core\Js::truthy($param)) {
            return null;
        }
        return Db::pool()->first($sql, [$param])['conference_id'] ?? null;
    }

    /** Conference id in the path (/:id/...). */
    public static function conference(): \Closure
    {
        return self::refuseWhenEnded(static fn (Req $req) => $req->param('id'));
    }

    /** Submission id in the path (/:sid/...). */
    public static function submission(): \Closure
    {
        return self::refuseWhenEnded(static fn (Req $req) => self::single('SELECT conference_id FROM submissions WHERE id = ? LIMIT 1', $req->param('sid')));
    }

    /** Review assignment id in the path (/assignments/:aid/...). */
    public static function assignment(): \Closure
    {
        return self::refuseWhenEnded(static fn (Req $req) => self::single('SELECT conference_id FROM review_assignments WHERE id = ? LIMIT 1', $req->param('aid')));
    }
}
