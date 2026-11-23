<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Auth\Session;
use App\Auth\SessionScope;
use App\Core\ForbiddenError;
use App\Core\UnauthorizedError;
use App\Db\Db;
use App\Http\Req;
use App\Modules\Auth\AuthService;

/**
 * Port of middleware/auth.ts. Middleware is fn(Req $req, callable $next): Response and
 * signals failure by throwing (Express's next(err)).
 */
final class Guards
{
    /** requireAuth: resolves the session, refuses another conference's path, opens the session scope. */
    public static function auth(): \Closure
    {
        return static function (Req $req, callable $next) {
            self::authenticate($req);
            return $next($req);
        };
    }

    public static function authenticate(Req $req): void
    {
        $user = Session::resolve($req);
        if ($user === null) {
            throw new UnauthorizedError('You must be signed in.');
        }
        $req->user = $user;
        if ($user->conferenceId) {
            $pathConferenceId = SessionScope::conferenceIdFromPath($req->originalUrl);
            if ($pathConferenceId && $pathConferenceId !== $user->conferenceId) {
                throw SessionScope::wrongConferenceError();
            }
        }
        SessionScope::enter($user->id, $user->conferenceId);
    }

    public static function hasAdminPowers(string $userId): bool
    {
        if (SessionScope::sessionConferenceId()) {
            return false;
        }
        return AuthService::isPlatformAdmin($userId);
    }

    public static function admin(): \Closure
    {
        return static function (Req $req, callable $next) {
            self::authenticate($req);
            if (!self::hasAdminPowers($req->user->id)) {
                throw new ForbiddenError('Administrator access required.');
            }
            return $next($req);
        };
    }

    public static function superAdmin(): \Closure
    {
        return static function (Req $req, callable $next) {
            self::authenticate($req);
            if (!self::hasAdminPowers($req->user->id)) {
                throw new ForbiddenError('Administrator access required.');
            }
            if (!AuthService::isSuperAdmin($req->user->id)) {
                throw new ForbiddenError('Only a super administrator can do this.');
            }
            return $next($req);
        };
    }

    /** @param (callable(Req): ?string)|null $getConferenceId default: req.params.id */
    public static function permission(string $permission, ?callable $getConferenceId = null): \Closure
    {
        return static function (Req $req, callable $next) use ($permission, $getConferenceId) {
            self::authenticate($req);
            $conferenceId = $getConferenceId !== null ? $getConferenceId($req) : $req->param('id');
            if (!\App\Core\Js::truthy($conferenceId)) {
                throw new ForbiddenError('Could not determine which conference this applies to.');
            }
            self::assertConferencePermission($req->user->id, $conferenceId, $permission);
            return $next($req);
        };
    }

    /** The one permission check every route and service uses. */
    public static function assertConferencePermission(string $userId, string $conferenceId, string $permission): void
    {
        SessionScope::assertConferenceInSession($conferenceId);
        if (self::hasAdminPowers($userId)) {
            return;
        }
        $permissions = AuthService::getConferencePermissions($userId, $conferenceId);
        if (!isset($permissions[$permission])) {
            throw new ForbiddenError('You do not have permission to do this.');
        }
    }

    /** @param list<string> $roleCodes */
    public static function role(array $roleCodes, ?callable $getConferenceId = null): \Closure
    {
        return static function (Req $req, callable $next) use ($roleCodes, $getConferenceId) {
            self::authenticate($req);
            $conferenceId = $getConferenceId !== null ? $getConferenceId($req) : $req->param('id');
            if (!\App\Core\Js::truthy($conferenceId)) {
                throw new ForbiddenError('Could not determine which conference this applies to.');
            }
            SessionScope::assertConferenceInSession($conferenceId);
            if (self::hasAdminPowers($req->user->id)) {
                return $next($req);
            }
            $rows = Db::query(
                "SELECT 1 FROM conference_members WHERE user_id = ? AND conference_id = ? AND status = 'active' AND role_code IN (?)",
                [$req->user->id, $conferenceId, $roleCodes],
            );
            if ($rows === []) {
                throw new ForbiddenError('You do not have permission to do this.');
            }
            return $next($req);
        };
    }
}
