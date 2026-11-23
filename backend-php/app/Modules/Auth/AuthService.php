<?php

declare(strict_types=1);

namespace App\Modules\Auth;

use App\Auth\SessionScope;
use App\Core\AppError;
use App\Core\BadRequestError;
use App\Core\DbError;
use App\Core\Env;
use App\Core\ForbiddenError;
use App\Core\Js;
use App\Core\NotFoundError;
use App\Core\UnauthorizedError;
use App\Db\Connection;
use App\Db\Db;
use App\Email\EmailQueue;
use App\Http\Res;
use App\Modules\Registration\RegistrationCore;
use App\Support\Audit;
use App\Support\Crypto;
use App\Support\Notifications;

/** Port of modules/auth/service.ts. */
final class AuthService
{
    public const BCRYPT_COST = 12;
    public const MAX_FAILED_LOGINS = 5;
    public const LOCK_MINUTES = 15;
    public const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
    public const PLATFORM_NAME = 'Conference CMS';

    private const GENERIC_LOGIN_ERROR = 'Email or password is incorrect.';
    public const ACCOUNT_EXISTS_MESSAGE =
        'An account with this email already exists. Enter its password to join this conference, or use another email.';

    private const ROLE_LABELS = [
        'author' => 'Author',
        'reviewer' => 'Reviewer',
        'session_chair' => 'Session Chair',
        'staff' => 'Staff',
        'manager' => 'Manager',
        'convenor' => 'Convenor',
        'admin' => 'Administrator',
        'attendee' => 'Audience',
    ];

    private const PROFILE_COLUMNS = ['full_name', 'phone', 'institution', 'department', 'position', 'country', 'orcid', 'bio', 'photo_path'];

    public static function roleLabel(string $code): string
    {
        return self::ROLE_LABELS[$code] ?? $code;
    }

    public static function hashPassword(string $password): string
    {
        return password_hash($password, PASSWORD_BCRYPT, ['cost' => self::BCRYPT_COST]);
    }

    /** Verifies $2a$/$2b$ (bcryptjs) and $2y$ (PHP) hashes alike. */
    public static function verifyPassword(string $password, string $hash): bool
    {
        return password_verify($password, $hash);
    }

    /** By id or slug, never a deleted conference; publishedOnly also hides drafts. */
    public static function findConference(string $ref, bool $publishedOnly, ?Connection $conn = null): ?array
    {
        $value = \App\Core\JsString::trim($ref);
        if ($value === '') {
            return null;
        }
        $conn ??= Db::pool();
        return $conn->first(
            'SELECT id, slug, name, status, logo_path, primary_color FROM conferences
             WHERE (id = ? OR slug = ?) AND deleted_at IS NULL ' . ($publishedOnly ? "AND status <> 'draft'" : '') . '
             LIMIT 1',
            [$value, \App\Core\JsString::lower($value)],
        );
    }

    public static function getMyRoles(string $userId, ?string $boundConferenceId = null): array
    {
        $confRows = Db::query(
            "SELECT cm.role_code, cm.conference_id, c.code AS conference_code, c.name AS conference_name,
                    c.slug AS conference_slug, c.status AS conference_status
             FROM conference_members cm
             JOIN conferences c ON c.id = cm.conference_id AND c.deleted_at IS NULL
             WHERE cm.user_id = ? AND cm.status = 'active' " . ($boundConferenceId ? 'AND cm.conference_id = ?' : ''),
            $boundConferenceId ? [$userId, $boundConferenceId] : [$userId],
        );
        if ($boundConferenceId) {
            return $confRows;
        }
        $platformRows = Db::query(
            'SELECT role_code, NULL AS conference_id, NULL AS conference_code, NULL AS conference_name,
                    NULL AS conference_slug, NULL AS conference_status
             FROM platform_user_roles WHERE user_id = ?',
            [$userId],
        );
        return [...$confRows, ...$platformRows];
    }

    public static function hasPlatformAdminRole(string $userId): bool
    {
        return Db::query("SELECT 1 FROM platform_user_roles WHERE user_id = ? AND role_code = 'admin' LIMIT 1", [$userId]) !== [];
    }

    /** Only through an unbound (admin) session, or outside any request. */
    public static function isPlatformAdmin(string $userId): bool
    {
        if (SessionScope::sessionConferenceId()) {
            return false;
        }
        return self::hasPlatformAdminRole($userId);
    }

    public static function superAdminsExist(): bool
    {
        return Db::query("SELECT 1 FROM platform_user_roles WHERE role_code = 'super_admin' LIMIT 1") !== [];
    }

    public static function isSuperAdmin(string $userId): bool
    {
        if (!self::isPlatformAdmin($userId)) {
            return false;
        }
        if (Db::query("SELECT 1 FROM platform_user_roles WHERE user_id = ? AND role_code = 'super_admin' LIMIT 1", [$userId]) !== []) {
            return true;
        }
        return !self::superAdminsExist();
    }

    /** @return array<string, true> permission code set */
    public static function getConferencePermissions(string $userId, string $conferenceId): array
    {
        $bound = SessionScope::sessionConferenceId();
        if ($bound && $bound !== $conferenceId) {
            return [];
        }
        $rows = Db::query(
            "SELECT DISTINCT rp.permission_code
             FROM conference_members cm
             JOIN role_permissions rp ON rp.role_code = cm.role_code
             WHERE cm.user_id = ? AND cm.conference_id = ? AND cm.status = 'active'",
            [$userId, $conferenceId],
        );
        $set = [];
        foreach ($rows as $r) {
            $set[(string) $r['permission_code']] = true;
        }
        return $set;
    }

    private static function joinAsAudience(Connection $conn, string $userId, string $conferenceId, ?string $categoryId, array $ctx): array
    {
        if ($conn->query("SELECT id FROM registrations WHERE conference_id = ? AND user_id = ? AND status <> 'cancelled' LIMIT 1", [$conferenceId, $userId]) !== []) {
            throw new AppError(409, 'You are already registered for this conference. Sign in to see your ticket.', null, 'already_registered');
        }
        if ($conn->query("SELECT 1 FROM conference_members WHERE conference_id = ? AND user_id = ? AND role_code = 'attendee' AND status = 'removed' LIMIT 1", [$conferenceId, $userId]) !== []) {
            throw new ForbiddenError("The organisers have removed you from this conference's Audience. Contact them if you think this is a mistake.");
        }
        RegistrationCore::ensureAudienceMembership($conn, $conferenceId, $userId, $ctx, 'signup');
        return RegistrationCore::registerInTransaction($conn, $conferenceId, $userId, (string) $categoryId, $ctx);
    }

    /** @return array{userId: string, registration: ?array} */
    public static function registerUser(array $input, array $ctx = []): array
    {
        return Db::tx(null, static function (Connection $conn) use ($input, $ctx): array {
            if ($conn->query('SELECT id FROM users WHERE email = ? LIMIT 1', [$input['email']]) !== []) {
                throw new AppError(409, self::ACCOUNT_EXISTS_MESSAGE, null, 'account_exists');
            }
            $conference = self::findConference($input['conference_id'], true, $conn);
            if ($conference === null || $conference['id'] !== $input['conference_id']) {
                throw new BadRequestError('Choose a valid conference.', ['conference_id' => 'Choose a valid conference.']);
            }

            $passwordHash = self::hashPassword($input['password']);
            $conn->run('INSERT INTO users (email, password_hash, full_name, phone) VALUES (?, ?, ?, ?)', [
                $input['email'], $passwordHash, $input['full_name'], $input['phone'],
            ]);
            $userId = $conn->first('SELECT id FROM users WHERE email = ? LIMIT 1', [$input['email']])['id'] ?? null;
            if (!$userId) {
                throw new AppError(500, 'Could not create the account.');
            }

            Audit::insert($conn, [
                'actorUserId' => $userId,
                'conferenceId' => $input['conference_id'],
                'action' => 'user.register',
                'entityType' => 'users',
                'entityId' => $userId,
                'newValues' => ['requested_role' => $input['requested_role']],
                'ipAddress' => $ctx['ipAddress'] ?? null,
                'userAgent' => $ctx['userAgent'] ?? null,
            ]);

            $registration = null;
            if ($input['requested_role'] === AuthValidation::AUDIENCE_ROLE) {
                $registration = self::joinAsAudience($conn, $userId, $input['conference_id'], $input['category_id'] ?? null, $ctx);
            } else {
                try {
                    $conn->run("INSERT INTO role_requests (user_id, conference_id, role_code, status) VALUES (?, ?, ?, 'pending')", [
                        $userId, $input['conference_id'], $input['requested_role'],
                    ]);
                } catch (DbError $e) {
                    if ($e->errno === 1062) {
                        throw new AppError(409, 'You already have a pending request for this role at this conference.');
                    }
                    throw $e;
                }
            }

            $template = $conn->first("SELECT subject FROM email_templates WHERE conference_id IS NULL AND template_key = 'account_created' LIMIT 1");
            $data = ['full_name' => $input['full_name'], 'platform_name' => self::PLATFORM_NAME];
            $subject = $template !== null ? EmailQueue::render($template['subject'], $data) : 'Welcome to ' . self::PLATFORM_NAME;
            EmailQueue::queue($conn, [
                'userId' => $userId,
                'conferenceId' => $input['conference_id'],
                'recipientEmail' => $input['email'],
                'templateKey' => 'account_created',
                'subject' => $subject,
                'templateData' => $data,
            ]);
            return ['userId' => $userId, 'registration' => $registration];
        });
    }

    private static function findUserByEmail(string $email): ?array
    {
        return Db::pool()->first('SELECT * FROM users WHERE email = ? LIMIT 1', [$email]);
    }

    public static function recordFailedLogin(string $userId, int $currentCount): void
    {
        $next = $currentCount + 1;
        if ($next >= self::MAX_FAILED_LOGINS) {
            Db::run('UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?', [
                $next, Crypto::nowPlusMs(self::LOCK_MINUTES * 60 * 1000), $userId,
            ]);
        } else {
            Db::run('UPDATE users SET failed_login_count = ? WHERE id = ?', [$next, $userId]);
        }
    }

    private static function recordSuccessfulLogin(string $userId): void
    {
        Db::run('UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = NOW(3) WHERE id = ?', [$userId]);
    }

    private static function isLocked(array $user): bool
    {
        return $user['locked_until'] !== null && Crypto::toMs($user['locked_until']) > Crypto::nowMs();
    }

    /** Password first; every refusal before it is the same generic message. @return array{userId: string, conference: array} */
    public static function verifyLogin(string $email, string $password, string $role, string $conferenceRef, array $ctx = []): array
    {
        $user = self::findUserByEmail($email);
        if ($user === null || !Js::truthy($user['password_hash'])) {
            throw new UnauthorizedError(self::GENERIC_LOGIN_ERROR);
        }
        if ($user['status'] !== 'active' || self::isLocked($user)) {
            throw new UnauthorizedError(self::GENERIC_LOGIN_ERROR);
        }
        if (!self::verifyPassword($password, $user['password_hash'])) {
            self::recordFailedLogin($user['id'], (int) $user['failed_login_count']);
            throw new UnauthorizedError(self::GENERIC_LOGIN_ERROR);
        }

        $conference = self::findConference($conferenceRef, false);
        if ($conference === null) {
            throw new NotFoundError('Conference not found.');
        }
        $refuse = static function (string $reason, string $message) use ($user, $conference, $role, $ctx): never {
            self::auditLoginRefusal($user['id'], $conference['id'], $role, $reason, $ctx);
            throw new AppError(403, $message, null, $reason);
        };

        $activeRoles = array_column(Db::query(
            "SELECT role_code FROM conference_members WHERE user_id = ? AND conference_id = ? AND status = 'active'",
            [$user['id'], $conference['id']],
        ), 'role_code');

        if (!in_array($role, $activeRoles, true)) {
            if ($role !== 'convenor') {
                $request = Db::pool()->first(
                    'SELECT status, reject_reason FROM role_requests WHERE user_id = ? AND conference_id = ? AND role_code = ?
                     ORDER BY created_at DESC LIMIT 1',
                    [$user['id'], $conference['id'], $role],
                );
                if (($request['status'] ?? null) === 'pending') {
                    $refuse('pending_approval', 'Your ' . self::roleLabel($role) . " request at {$conference['name']} is waiting for the convenor's approval.");
                }
                if (($request['status'] ?? null) === 'rejected') {
                    $refuse('request_rejected', 'Your ' . self::roleLabel($role) . " request at {$conference['name']} was rejected: " . ($request['reject_reason'] ?? 'No reason given.'));
                }
            }
            if ($activeRoles !== []) {
                $refuse('role_not_held', "You don't have the " . self::roleLabel($role) . " role at {$conference['name']}. Your roles here: "
                    . implode(', ', array_map([self::class, 'roleLabel'], $activeRoles)) . '.');
            }
            $refuse('no_role_at_conference', "This account has no role at {$conference['name']} yet. Request a role for this conference, or sign in at a conference where you already have a role.");
        }

        self::recordSuccessfulLogin($user['id']);
        return ['userId' => $user['id'], 'conference' => $conference];
    }

    private static function auditLoginRefusal(string $userId, string $conferenceId, string $role, string $reason, array $ctx): void
    {
        Db::tx($userId, static fn (Connection $conn) => Audit::insert($conn, [
            'actorUserId' => $userId,
            'conferenceId' => $conferenceId,
            'action' => 'auth.login_refused_conference',
            'entityType' => 'users',
            'entityId' => $userId,
            'newValues' => ['role' => $role, 'reason' => $reason],
            'ipAddress' => $ctx['ipAddress'] ?? null,
            'userAgent' => $ctx['userAgent'] ?? null,
        ]));
    }

    /** @return array{userId: string} */
    public static function verifyAdminLogin(string $email, string $password): array
    {
        $user = self::findUserByEmail($email);
        if ($user === null || !Js::truthy($user['password_hash']) || $user['status'] !== 'active' || self::isLocked($user)) {
            throw new UnauthorizedError(self::GENERIC_LOGIN_ERROR);
        }
        if (!self::verifyPassword($password, $user['password_hash'])) {
            self::recordFailedLogin($user['id'], (int) $user['failed_login_count']);
            throw new UnauthorizedError(self::GENERIC_LOGIN_ERROR);
        }
        if (!self::hasPlatformAdminRole($user['id'])) {
            throw new UnauthorizedError(self::GENERIC_LOGIN_ERROR);
        }
        self::recordSuccessfulLogin($user['id']);
        return ['userId' => $user['id']];
    }

    public static function changePassword(string $userId, string $currentPassword, string $newPassword, string $currentSessionId, array $ctx = []): void
    {
        $row = Db::pool()->first('SELECT password_hash FROM users WHERE id = ? LIMIT 1', [$userId]);
        if ($row === null || !Js::truthy($row['password_hash'])) {
            throw new AppError(400, 'This account has no password set.');
        }
        if (!self::verifyPassword($currentPassword, $row['password_hash'])) {
            throw new BadRequestError('Current password is incorrect.', ['current_password' => 'Current password is incorrect.']);
        }
        $newHash = self::hashPassword($newPassword);
        Db::tx($userId, static function (Connection $conn) use ($userId, $newHash, $currentSessionId, $ctx): void {
            $conn->run('UPDATE users SET password_hash = ? WHERE id = ?', [$newHash, $userId]);
            $conn->run('UPDATE auth_sessions SET revoked_at = NOW(3) WHERE user_id = ? AND id <> ? AND revoked_at IS NULL', [$userId, $currentSessionId]);
            Audit::insert($conn, [
                'actorUserId' => $userId,
                'action' => 'user.change_password',
                'entityType' => 'users',
                'entityId' => $userId,
                'ipAddress' => $ctx['ipAddress'] ?? null,
                'userAgent' => $ctx['userAgent'] ?? null,
            ]);
        });
    }

    /** @param array{id: string, email: string, full_name: string} $user @param array{slug: string}|null $conference */
    public static function issuePasswordReset(Connection $conn, array $user, ?array $conference = null): void
    {
        $conn->run("UPDATE auth_tokens SET used_at = NOW(3) WHERE user_id = ? AND purpose = 'password_reset' AND used_at IS NULL", [$user['id']]);
        $rawToken = Crypto::generateToken();
        $conn->run("INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES (?, 'password_reset', ?, ?)", [
            $user['id'], Crypto::sha256($rawToken), Crypto::nowPlusMs(self::RESET_TOKEN_TTL_MS),
        ]);
        $template = $conn->first("SELECT subject FROM email_templates WHERE conference_id IS NULL AND template_key = 'password_reset' LIMIT 1");
        $appUrl = Env::get('APP_URL');
        $resetUrl = $conference !== null
            ? "{$appUrl}/c/" . Res::encodeURIComponent($conference['slug']) . "/reset-password?token={$rawToken}"
            : "{$appUrl}/reset-password?token={$rawToken}";
        $data = ['full_name' => $user['full_name'], 'reset_url' => $resetUrl];
        EmailQueue::queue($conn, [
            'userId' => $user['id'],
            'recipientEmail' => $user['email'],
            'templateKey' => 'password_reset',
            'subject' => $template !== null ? EmailQueue::render($template['subject'], $data) : 'Reset your password',
            'templateData' => $data,
        ]);
    }

    public static function requestPasswordReset(string $email, ?string $conferenceRef = null): void
    {
        $user = self::findUserByEmail($email);
        if ($user === null || $user['status'] !== 'active') {
            return;
        }
        $conference = Js::truthy($conferenceRef) ? self::findConference($conferenceRef, true) : null;
        Db::tx($user['id'], static fn (Connection $conn) => self::issuePasswordReset($conn, $user, $conference));
    }

    public static function resetPassword(string $token, string $newPassword, array $ctx = []): void
    {
        $row = Db::pool()->first(
            "SELECT id, user_id FROM auth_tokens
             WHERE token_hash = ? AND purpose = 'password_reset' AND used_at IS NULL AND expires_at > NOW(3)
             LIMIT 1",
            [Crypto::sha256($token)],
        );
        if ($row === null) {
            throw new BadRequestError('This reset link is invalid or has expired.');
        }
        $newHash = self::hashPassword($newPassword);
        Db::tx($row['user_id'], static function (Connection $conn) use ($row, $newHash, $ctx): void {
            $conn->run('UPDATE users SET password_hash = ?, failed_login_count = 0, locked_until = NULL WHERE id = ?', [$newHash, $row['user_id']]);
            $conn->run('UPDATE auth_tokens SET used_at = NOW(3) WHERE id = ?', [$row['id']]);
            $conn->run('UPDATE auth_sessions SET revoked_at = NOW(3) WHERE user_id = ? AND revoked_at IS NULL', [$row['user_id']]);
            Audit::insert($conn, [
                'actorUserId' => $row['user_id'],
                'action' => 'user.reset_password',
                'entityType' => 'users',
                'entityId' => $row['user_id'],
                'ipAddress' => $ctx['ipAddress'] ?? null,
                'userAgent' => $ctx['userAgent'] ?? null,
            ]);
        });
    }

    /** @return array{userId: string} */
    public static function acceptInvitation(string $token, string $newPassword, array $ctx = []): array
    {
        $row = Db::pool()->first(
            "SELECT id, user_id, created_by FROM auth_tokens
             WHERE token_hash = ? AND purpose = 'invitation' AND used_at IS NULL AND expires_at > NOW(3)
             LIMIT 1",
            [Crypto::sha256($token)],
        );
        if ($row === null) {
            throw new BadRequestError('This invitation link is invalid or has expired.');
        }
        $newHash = self::hashPassword($newPassword);
        Db::tx($row['user_id'], static function (Connection $conn) use ($row, $newHash, $ctx): void {
            $conn->run('UPDATE users SET password_hash = ? WHERE id = ?', [$newHash, $row['user_id']]);
            $conn->run('UPDATE auth_tokens SET used_at = NOW(3) WHERE id = ?', [$row['id']]);
            Audit::insert($conn, [
                'actorUserId' => $row['user_id'],
                'action' => 'user.accept_invitation',
                'entityType' => 'users',
                'entityId' => $row['user_id'],
                'ipAddress' => $ctx['ipAddress'] ?? null,
                'userAgent' => $ctx['userAgent'] ?? null,
            ]);
            if (Js::truthy($row['created_by'])) {
                $fullName = $conn->first('SELECT full_name FROM users WHERE id = ? LIMIT 1', [$row['user_id']])['full_name'] ?? 'A new user';
                Notifications::notifyUser($conn, [
                    'userId' => $row['created_by'],
                    'type' => 'system',
                    'title' => 'Invitation accepted',
                    'body' => "{$fullName} has set their password and can now sign in.",
                ]);
            }
        });
        return ['userId' => $row['user_id']];
    }

    public static function invitationSessionConference(string $userId, ?string $conferenceRef): ?array
    {
        if (!Js::truthy($conferenceRef)) {
            return null;
        }
        $conference = self::findConference($conferenceRef, false);
        if ($conference === null) {
            return null;
        }
        $rows = Db::query("SELECT 1 FROM conference_members WHERE user_id = ? AND conference_id = ? AND status = 'active' LIMIT 1", [$userId, $conference['id']]);
        return $rows !== [] ? $conference : null;
    }

    private static function createPendingRoleRequest(Connection $conn, string $userId, array $conference, string $role, array $ctx, string $source): void
    {
        $label = self::roleLabel($role);
        if ($conn->query("SELECT 1 FROM conference_members WHERE user_id = ? AND conference_id = ? AND role_code = ? AND status = 'active' LIMIT 1", [$userId, $conference['id'], $role]) !== []) {
            throw new AppError(409, "You already have the {$label} role at {$conference['name']}. Sign in at this conference to use it.", null, 'role_already_active');
        }
        $pendingMessage = "You already have a pending {$label} request at {$conference['name']}. You can sign in there once the convenor approves it.";
        if ($conn->query("SELECT 1 FROM role_requests WHERE user_id = ? AND conference_id = ? AND role_code = ? AND status = 'pending' LIMIT 1", [$userId, $conference['id'], $role]) !== []) {
            throw new AppError(409, $pendingMessage, null, 'role_request_pending');
        }
        try {
            $conn->run("INSERT INTO role_requests (user_id, conference_id, role_code, status) VALUES (?, ?, ?, 'pending')", [$userId, $conference['id'], $role]);
        } catch (DbError $e) {
            if ($e->errno === 1062) {
                throw new AppError(409, $pendingMessage, null, 'role_request_pending');
            }
            throw $e;
        }
        Audit::insert($conn, [
            'actorUserId' => $userId,
            'conferenceId' => $conference['id'],
            'action' => 'role_request.create',
            'entityType' => 'users',
            'entityId' => $userId,
            'newValues' => ['role_code' => $role, 'source' => $source],
            'ipAddress' => $ctx['ipAddress'] ?? null,
            'userAgent' => $ctx['userAgent'] ?? null,
        ]);
        $user = $conn->first('SELECT email, full_name FROM users WHERE id = ? LIMIT 1', [$userId]);
        if ($user !== null) {
            $template = $conn->first("SELECT subject FROM email_templates WHERE conference_id IS NULL AND template_key = 'role_request_received' LIMIT 1");
            $data = ['full_name' => $user['full_name'], 'role_name' => $label, 'conference_name' => $conference['name']];
            EmailQueue::queue($conn, [
                'userId' => $userId,
                'conferenceId' => $conference['id'],
                'recipientEmail' => $user['email'],
                'templateKey' => 'role_request_received',
                'subject' => $template !== null ? EmailQueue::render($template['subject'], $data) : "We received your {$label} request",
                'templateData' => $data,
            ]);
        }
    }

    /** @return array{conference: array, userId: string, registration: ?array} */
    public static function joinConferenceWithExistingAccount(array $input, array $ctx = []): array
    {
        $conference = self::findConference($input['conference'], true);
        if ($conference === null) {
            throw new NotFoundError('Conference not found.');
        }
        $user = self::findUserByEmail($input['email']);
        $wrongPassword = static fn () => new AppError(401, self::ACCOUNT_EXISTS_MESSAGE, ['password' => 'This password is not correct for this account.'], 'account_exists');
        if ($user === null || !Js::truthy($user['password_hash']) || $user['status'] !== 'active') {
            throw $wrongPassword();
        }
        if (self::isLocked($user)) {
            throw $wrongPassword();
        }
        if (!self::verifyPassword($input['password'], $user['password_hash'])) {
            self::recordFailedLogin($user['id'], (int) $user['failed_login_count']);
            throw $wrongPassword();
        }
        if ($input['requested_role'] === AuthValidation::AUDIENCE_ROLE) {
            $registration = Db::tx($user['id'], static fn (Connection $conn) => self::joinAsAudience($conn, $user['id'], $conference['id'], $input['category_id'] ?? null, $ctx));
            return ['conference' => $conference, 'userId' => $user['id'], 'registration' => $registration];
        }
        Db::tx($user['id'], static fn (Connection $conn) => self::createPendingRoleRequest($conn, $user['id'], $conference, $input['requested_role'], $ctx, 'join_existing_account'));
        return ['conference' => $conference, 'userId' => $user['id'], 'registration' => null];
    }

    /** @return array{conference: array, registration: ?array} */
    public static function requestRoleAsSignedInUser(string $userId, string $conferenceRef, string $role, array $ctx = [], ?string $categoryId = null): array
    {
        $conference = self::findConference($conferenceRef, true);
        if ($conference === null) {
            throw new NotFoundError('Conference not found.');
        }
        if ($role === AuthValidation::AUDIENCE_ROLE) {
            $registration = Db::tx($userId, static fn (Connection $conn) => self::joinAsAudience($conn, $userId, $conference['id'], $categoryId, $ctx));
            return ['conference' => $conference, 'registration' => $registration];
        }
        Db::tx($userId, static fn (Connection $conn) => self::createPendingRoleRequest($conn, $userId, $conference, $role, $ctx, 'signed_in_request'));
        return ['conference' => $conference, 'registration' => null];
    }

    public static function listMyConferences(string $userId): array
    {
        $activeRows = Db::query(
            "SELECT c.id AS conference_id, c.slug, c.name, c.logo_path, c.primary_color, c.status, cm.role_code
             FROM conference_members cm
             JOIN conferences c ON c.id = cm.conference_id AND c.deleted_at IS NULL
             WHERE cm.user_id = ? AND cm.status = 'active'",
            [$userId],
        );
        $pendingRows = Db::query(
            "SELECT c.id AS conference_id, c.slug, c.name, c.logo_path, c.primary_color, c.status, rr.role_code
             FROM role_requests rr
             JOIN conferences c ON c.id = rr.conference_id AND c.deleted_at IS NULL
             WHERE rr.user_id = ? AND rr.status = 'pending'",
            [$userId],
        );
        $byId = [];
        $entry = static function (array $r) use (&$byId): string {
            $id = $r['conference_id'];
            $byId[$id] ??= [
                'conference_id' => $id,
                'slug' => $r['slug'],
                'name' => $r['name'],
                'logo_path' => $r['logo_path'],
                'primary_color' => $r['primary_color'],
                'status' => $r['status'],
                'roles' => [],
                'pending_roles' => [],
            ];
            return $id;
        };
        foreach ($activeRows as $r) {
            $byId[$entry($r)]['roles'][] = $r['role_code'];
        }
        foreach ($pendingRows as $r) {
            $id = $entry($r);
            if (!in_array($r['role_code'], $byId[$id]['roles'], true)) {
                $byId[$id]['pending_roles'][] = $r['role_code'];
            }
        }
        $list = array_values($byId);
        $collator = new \Collator('en_US');
        usort($list, static fn ($a, $b) => $collator->compare($a['name'], $b['name']));
        return $list;
    }

    /** @return array{conference: array, roles: list<string>} */
    public static function assertCanSwitchTo(string $userId, string $conferenceId): array
    {
        $conference = self::findConference($conferenceId, false);
        if ($conference === null || $conference['id'] !== $conferenceId) {
            throw new NotFoundError('Conference not found.');
        }
        $roles = array_column(Db::query(
            "SELECT role_code FROM conference_members WHERE user_id = ? AND conference_id = ? AND status = 'active'",
            [$userId, $conferenceId],
        ), 'role_code');
        if ($roles === []) {
            throw new ForbiddenError("You don't have an active role at {$conference['name']}. Requests waiting for approval can't be opened yet.");
        }
        return ['conference' => $conference, 'roles' => $roles];
    }

    /** Only keys present in the validated input are written (undefined = untouched). */
    public static function updateProfile(string $userId, array $input): void
    {
        $assignments = [];
        $values = [];
        foreach (self::PROFILE_COLUMNS as $column) {
            if (!array_key_exists($column, $input) || \App\Core\Json::isUndef($input[$column])) {
                continue;
            }
            $assignments[] = "{$column} = ?";
            $values[] = $input[$column];
        }
        if ($assignments === []) {
            return;
        }
        $values[] = $userId;
        Db::run('UPDATE users SET ' . implode(', ', $assignments) . ' WHERE id = ?', $values);
    }

    public static function getUserProfile(string $userId): ?array
    {
        return Db::pool()->first(
            'SELECT id, email, full_name, phone, institution, department, position, bio, country, orcid, photo_path
             FROM users WHERE id = ? LIMIT 1',
            [$userId],
        );
    }
}
