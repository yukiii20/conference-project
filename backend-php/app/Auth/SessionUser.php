<?php

declare(strict_types=1);

namespace App\Auth;

/** Port of SessionUser (modules/auth/session.ts). */
final class SessionUser
{
    public function __construct(
        public readonly string $id,
        public readonly string $email,
        public readonly string $fullName,
        public readonly string $status,
        public readonly bool $isAdminSession,
        public readonly string $sessionId,
        /** The conference the session was signed in at; null only for a platform admin session. */
        public readonly ?string $conferenceId,
    ) {
    }
}
