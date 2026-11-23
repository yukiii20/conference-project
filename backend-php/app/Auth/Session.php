<?php

declare(strict_types=1);

namespace App\Auth;

use App\Core\Env;
use App\Db\Connection;
use App\Db\Db;
use App\Http\CookieJar;
use App\Http\Req;
use App\Support\Crypto;

/** Port of modules/auth/session.ts. The framework's own session driver is never used. */
final class Session
{
    public const COOKIE = 'cms_session';
    public const REMEMBER_ME_MS = 30 * 24 * 60 * 60 * 1000;
    public const DEFAULT_SESSION_MS = 12 * 60 * 60 * 1000;
    public const ADMIN_IDLE_MS = 30 * 60 * 1000;

    /** Creates the auth_sessions row (inside the caller's transaction) and queues the cookie. */
    public static function create(
        Connection $conn,
        string $userId,
        bool $rememberMe,
        bool $isAdminSession,
        ?string $conferenceId,
        ?string $userAgent,
        ?string $ipAddress,
    ): void {
        $token = Crypto::generateToken();
        $tokenHash = Crypto::sha256($token);
        $conferenceId = $isAdminSession ? null : $conferenceId;
        if (!$isAdminSession && !$conferenceId) {
            throw new \LogicException('A non-admin session must be bound to a conference.');
        }
        $rememberMe = $isAdminSession ? false : $rememberMe;
        $ttlMs = $isAdminSession ? self::ADMIN_IDLE_MS : ($rememberMe ? self::REMEMBER_ME_MS : self::DEFAULT_SESSION_MS);
        $expiresAt = Crypto::nowPlusMs($ttlMs);

        $conn->run(
            'INSERT INTO auth_sessions (user_id, token_hash, remember_me, is_admin_session, conference_id, user_agent, ip_address, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$userId, $tokenHash, $rememberMe, $isAdminSession, $conferenceId, $userAgent, $ipAddress, $expiresAt],
        );

        $opts = ['httpOnly' => true, 'secure' => Env::isProduction(), 'sameSite' => 'lax', 'path' => '/'];
        if ($rememberMe) {
            $opts['maxAgeMs'] = self::REMEMBER_ME_MS;
        }
        CookieJar::set(self::COOKIE, $token, $opts);
    }

    public static function clearCookie(): void
    {
        CookieJar::clear(self::COOKIE, '/');
    }

    public static function token(Req $req): ?string
    {
        $raw = $req->cookies[self::COOKIE] ?? null;
        return is_string($raw) && $raw !== '' ? $raw : null;
    }

    /**
     * Validates the cookie against auth_sessions + users: slides the admin idle window,
     * revokes sessions whose user is no longer active or whose conference is gone.
     */
    public static function resolve(Req $req): ?SessionUser
    {
        $token = self::token($req);
        if ($token === null) {
            return null;
        }
        $row = Db::pool()->first(
            'SELECT s.id AS session_id, s.user_id, s.remember_me, s.is_admin_session, s.conference_id, s.last_seen_at, s.expires_at,
                    u.email, u.full_name, u.status, c.id AS bound_conference_id
             FROM auth_sessions s
             JOIN users u ON u.id = s.user_id
             LEFT JOIN conferences c ON c.id = s.conference_id AND c.deleted_at IS NULL
             WHERE s.token_hash = ? AND s.revoked_at IS NULL
             LIMIT 1',
            [Crypto::sha256($token)],
        );
        if ($row === null) {
            return null;
        }
        $nowMs = Crypto::nowMs();

        if (!$row['is_admin_session'] && (!$row['conference_id'] || !$row['bound_conference_id'])) {
            Db::run('UPDATE auth_sessions SET revoked_at = NOW(3) WHERE id = ?', [$row['session_id']]);
            return null;
        }

        if ($row['is_admin_session']) {
            $lastSeen = Crypto::toMs($row['last_seen_at']);
            if ($nowMs - $lastSeen > self::ADMIN_IDLE_MS) {
                Db::run('UPDATE auth_sessions SET revoked_at = NOW(3) WHERE id = ?', [$row['session_id']]);
                return null;
            }
            Db::run('UPDATE auth_sessions SET last_seen_at = NOW(3), expires_at = ? WHERE id = ?', [
                Crypto::nowPlusMs(self::ADMIN_IDLE_MS),
                $row['session_id'],
            ]);
        } else {
            if (Crypto::toMs($row['expires_at']) < $nowMs) {
                return null;
            }
            Db::run('UPDATE auth_sessions SET last_seen_at = NOW(3) WHERE id = ?', [$row['session_id']]);
        }

        if ($row['status'] !== 'active') {
            Db::run('UPDATE auth_sessions SET revoked_at = NOW(3) WHERE id = ?', [$row['session_id']]);
            return null;
        }

        return new SessionUser(
            (string) $row['user_id'],
            (string) $row['email'],
            (string) $row['full_name'],
            (string) $row['status'],
            (bool) $row['is_admin_session'],
            (string) $row['session_id'],
            $row['is_admin_session'] ? null : (string) $row['conference_id'],
        );
    }

    public static function revoke(string $sessionId): void
    {
        Db::run('UPDATE auth_sessions SET revoked_at = NOW(3) WHERE id = ?', [$sessionId]);
    }
}
