<?php

declare(strict_types=1);

namespace App\Modules\Registration;

use App\Core\BadRequestError;
use App\Core\ConflictError;
use App\Core\DbError;
use App\Core\NotFoundError;
use App\Db\Connection;
use App\Db\Db;
use App\Modules\Audience\Ticket;
use App\Modules\Submissions\DeadlineWindow;
use App\Support\Audit;
use App\Support\ConferenceEnded;
use App\Support\Crypto;

/**
 * The registration steps shared with sign-up (modules/registration/service.ts:
 * ensureAtLeastOneCategory, register, ensureAudienceMembership, registerInTransaction).
 */
final class RegistrationCore
{
    /** Auto-creates a single "general" category the first time anyone looks to register. */
    public static function ensureAtLeastOneCategory(Connection $conn, string $conferenceId): void
    {
        if ($conn->query('SELECT 1 FROM registration_categories WHERE conference_id = ? LIMIT 1', [$conferenceId]) !== []) {
            return;
        }
        $conn->run(
            "INSERT INTO registration_categories (conference_id, code, name, description, is_active, display_order)
             VALUES (?, 'general', 'General', NULL, TRUE, 0)",
            [$conferenceId],
        );
    }

    public static function register(string $conferenceId, string $userId, string $categoryId, array $ctx = []): array
    {
        return Db::tx($userId, static fn (Connection $conn) => self::registerInTransaction($conn, $conferenceId, $userId, $categoryId, $ctx));
    }

    /** Gives the Audience role, active at once; never reactivates a removed membership. True when created. */
    public static function ensureAudienceMembership(Connection $conn, string $conferenceId, string $userId, array $ctx = [], string $source = 'registration'): bool
    {
        $result = $conn->run(
            "INSERT IGNORE INTO conference_members (conference_id, user_id, role_code, status, added_by)
             VALUES (?, ?, 'attendee', 'active', ?)",
            [$conferenceId, $userId, $userId],
        );
        $created = $result->affectedRows > 0;
        if ($created) {
            Audit::insert($conn, [
                'actorUserId' => $userId,
                'conferenceId' => $conferenceId,
                'action' => 'member.audience_granted',
                'entityType' => 'users',
                'entityId' => $userId,
                'newValues' => ['role_code' => 'attendee', 'status' => 'active', 'source' => $source],
                'ipAddress' => $ctx['ipAddress'] ?? null,
                'userAgent' => $ctx['userAgent'] ?? null,
            ]);
        }
        return $created;
    }

    /**
     * @return array{id: string, registration_number: string, status: string, amount_due: int|float, currency: string}
     */
    public static function registerInTransaction(Connection $conn, string $conferenceId, string $userId, string $categoryId, array $ctx = []): array
    {
        ConferenceEnded::assertNotEnded($conn, $conferenceId);
        $window = DeadlineWindow::load($conferenceId, 'registration');
        if (!DeadlineWindow::isOpen($window)) {
            throw new ConflictError('Registration is not open right now.');
        }

        self::ensureAtLeastOneCategory($conn, $conferenceId);
        $category = $conn->query(
            'SELECT id FROM registration_categories WHERE id = ? AND conference_id = ? AND is_active = TRUE LIMIT 1',
            [$categoryId, $conferenceId],
        );
        if ($category === []) {
            throw new BadRequestError('Choose a valid, active registration category.');
        }

        $conference = $conn->first(
            'SELECT co.code, cs.registration_requires_payment, cs.default_currency
             FROM conferences co JOIN conference_settings cs ON cs.conference_id = co.id
             WHERE co.id = ? AND co.deleted_at IS NULL LIMIT 1',
            [$conferenceId],
        );
        if ($conference === null) {
            throw new NotFoundError('This conference does not exist.');
        }

        $conn->run(
            "INSERT INTO conference_counters (conference_id, counter_key, current_value) VALUES (?, 'registration', 0)
             ON DUPLICATE KEY UPDATE conference_id = conference_id",
            [$conferenceId],
        );
        $counter = $conn->first(
            "SELECT current_value FROM conference_counters WHERE conference_id = ? AND counter_key = 'registration' FOR UPDATE",
            [$conferenceId],
        );
        $next = (int) ($counter['current_value'] ?? 0) + 1;
        $conn->run("UPDATE conference_counters SET current_value = ? WHERE conference_id = ? AND counter_key = 'registration'", [$next, $conferenceId]);
        $registrationNumber = $conference['code'] . '-R' . str_pad((string) $next, 4, '0', STR_PAD_LEFT);
        $price = Fees::priceForNewRegistration($conn, $categoryId, (string) $conference['default_currency']);
        $status = ($price['amount'] > 0 || $conference['registration_requires_payment']) ? 'pending' : 'confirmed';
        $qrToken = Crypto::generateUrlSafeToken(48);

        try {
            $conn->run(
                'INSERT INTO registrations
                   (conference_id, user_id, category_id, fee_id, registration_number, status, amount_due, currency, qr_token, confirmed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ' . ($status === 'confirmed' ? 'NOW(3)' : 'NULL') . ')',
                [$conferenceId, $userId, $categoryId, $price['feeId'], $registrationNumber, $status, $price['amount'], $price['currency'], $qrToken],
            );
        } catch (DbError $e) {
            if ($e->errno === 1062) {
                throw new ConflictError('You already have an active registration for this conference.');
            }
            throw $e;
        }

        $id = (string) $conn->first('SELECT id FROM registrations WHERE registration_number = ? LIMIT 1', [$registrationNumber])['id'];

        Audit::insert($conn, [
            'actorUserId' => $userId,
            'conferenceId' => $conferenceId,
            'action' => 'registration.create',
            'entityType' => 'registrations',
            'entityId' => $id,
            'newValues' => ['category_id' => $categoryId, 'status' => $status, 'fee_id' => $price['feeId'], 'amount_due' => $price['amount'], 'currency' => $price['currency']],
            'ipAddress' => $ctx['ipAddress'] ?? null,
            'userAgent' => $ctx['userAgent'] ?? null,
        ]);
        self::ensureAudienceMembership($conn, $conferenceId, $userId, $ctx);
        Ticket::queueTicketEmail($conn, $conferenceId, $userId);
        return ['id' => $id, 'registration_number' => $registrationNumber, 'status' => $status, 'amount_due' => $price['amount'], 'currency' => $price['currency']];
    }
}
