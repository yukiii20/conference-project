<?php

declare(strict_types=1);

namespace App\Auth;

use App\Core\ForbiddenError;

/**
 * Port of middleware/sessionScope.ts. Node kept this in AsyncLocalStorage; PHP serves one
 * request per process, so a static that requireAuth sets and the kernel clears is enough.
 * conferenceId === null means "not bound": an admin session, or code outside a request (jobs).
 */
final class SessionScope
{
    public const WRONG_CONFERENCE_MESSAGE = 'You are signed in to a different conference. Sign in at this conference to continue.';
    public const WRONG_CONFERENCE_CODE = 'wrong_conference';

    private static ?string $userId = null;
    private static ?string $conferenceId = null;
    private static bool $active = false;

    public static function enter(string $userId, ?string $conferenceId): void
    {
        self::$userId = $userId;
        self::$conferenceId = $conferenceId;
        self::$active = true;
    }

    public static function clear(): void
    {
        self::$userId = null;
        self::$conferenceId = null;
        self::$active = false;
    }

    /**
     * Runs $fn outside any session scope and restores the previous one (Node's code that ran
     * after the response, or in a job, had no scope).
     *
     * @template T
     * @param callable(): T $fn
     * @return T
     */
    public static function unbound(callable $fn): mixed
    {
        [$u, $c, $a] = [self::$userId, self::$conferenceId, self::$active];
        self::clear();
        try {
            return $fn();
        } finally {
            [self::$userId, self::$conferenceId, self::$active] = [$u, $c, $a];
        }
    }

    public static function sessionConferenceId(): ?string
    {
        return self::$active ? self::$conferenceId : null;
    }

    public static function wrongConferenceError(): ForbiddenError
    {
        $err = new ForbiddenError(self::WRONG_CONFERENCE_MESSAGE);
        $err->errorCode = self::WRONG_CONFERENCE_CODE;
        return $err;
    }

    public static function assertConferenceInSession(?string $conferenceId): void
    {
        $bound = self::sessionConferenceId();
        if ($bound === null) {
            return;
        }
        if ($conferenceId === null || $conferenceId === '' || $conferenceId !== $bound) {
            throw self::wrongConferenceError();
        }
    }

    public static function effectiveConferenceFilter(?string $requested): ?string
    {
        $bound = self::sessionConferenceId();
        if ($bound === null) {
            return ($requested === '' ? null : $requested);
        }
        if ($requested !== null && $requested !== '' && $requested !== $bound) {
            throw self::wrongConferenceError();
        }
        return $bound;
    }

    /**
     * @template T
     * @param list<T> $rows
     * @param callable(T): (string|null) $conferenceIdOf
     * @return list<T>
     */
    public static function keepBoundConferenceRows(array $rows, callable $conferenceIdOf): array
    {
        $bound = self::sessionConferenceId();
        if ($bound === null) {
            return $rows;
        }
        return array_values(array_filter($rows, static fn ($row) => $conferenceIdOf($row) === $bound));
    }

    private const UUID_PATTERN = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i';

    /** The conference id in a `/api/conferences/:id/...` URL (UUIDs only). */
    public static function conferenceIdFromPath(string $originalUrl): ?string
    {
        $path = explode('?', $originalUrl, 2)[0];
        if (!preg_match('#^/api/conferences/([^/]+)#', $path, $m)) {
            return null;
        }
        if (!preg_match(self::UUID_PATTERN, $m[1])) {
            return null;
        }
        return strtolower($m[1]);
    }
}
