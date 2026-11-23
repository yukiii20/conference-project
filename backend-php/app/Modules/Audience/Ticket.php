<?php

declare(strict_types=1);

namespace App\Modules\Audience;

use App\Core\AppError;
use App\Core\Env;
use App\Core\NotFoundError;
use App\Db\Connection;
use App\Db\Db;
use App\Email\EmailQueue;
use App\Support\Audit;

/** Port of modules/audience/ticket.ts. */
final class Ticket
{
    private const STATUS_LABELS = [
        'pending' => 'Waiting for payment or confirmation',
        'confirmed' => 'Confirmed',
        'waitlisted' => 'On the waiting list',
    ];

    private static function dateOnly(mixed $value): string
    {
        if ($value instanceof \DateTimeInterface) {
            return \App\Core\Json::isoDate($value) !== '' ? substr(\App\Core\Json::isoDate($value), 0, 10) : '';
        }
        return substr((string) $value, 0, 10);
    }

    /** Queues the ticket email for the person's current registration; null when there is none. */
    public static function queueTicketEmail(Connection $conn, string $conferenceId, string $userId): ?int
    {
        $row = $conn->first(
            "SELECT r.id AS registration_id, r.registration_number, r.status, rc.name AS category_name,
                    u.full_name, u.email, c.code AS conference_code, c.name AS conference_name, c.slug, c.start_date, c.end_date
             FROM registrations r
             JOIN registration_categories rc ON rc.id = r.category_id
             JOIN users u ON u.id = r.user_id
             JOIN conferences c ON c.id = r.conference_id
             WHERE r.conference_id = ? AND r.user_id = ? AND r.status <> 'cancelled'
             ORDER BY r.registered_at DESC LIMIT 1",
            [$conferenceId, $userId],
        );
        if ($row === null) {
            return null;
        }
        $template = $conn->first("SELECT subject FROM email_templates WHERE conference_id IS NULL AND template_key = 'audience_ticket' LIMIT 1");
        $start = self::dateOnly($row['start_date']);
        $end = self::dateOnly($row['end_date']);
        $data = [
            'full_name' => $row['full_name'],
            'conference_code' => $row['conference_code'],
            'conference_name' => $row['conference_name'],
            'conference_dates' => $start === $end ? $start : "{$start} to {$end}",
            'registration_number' => $row['registration_number'],
            'category_name' => $row['category_name'],
            'status' => self::STATUS_LABELS[$row['status']] ?? $row['status'],
            'ticket_url' => Env::get('APP_URL') . '/c/' . $row['slug'] . '/ticket',
        ];
        $subject = $template['subject'] ?? '[{{conference_code}}] Your ticket {{registration_number}}';
        return EmailQueue::queue($conn, [
            'userId' => $userId,
            'conferenceId' => $conferenceId,
            'recipientEmail' => $row['email'],
            'templateKey' => 'audience_ticket',
            'subject' => EmailQueue::render($subject, $data),
            'templateData' => $data,
            'entityType' => 'registrations',
            'entityId' => $row['registration_id'],
        ]);
    }

    /** "Email me my ticket": at most 3 per hour per person (counted in email_logs). */
    public static function resendTicketEmail(string $conferenceId, string $userId, array $ctx = []): void
    {
        $recent = Db::pool()->first(
            "SELECT COUNT(*) AS n FROM email_logs
             WHERE user_id = ? AND conference_id = ? AND template_key = 'audience_ticket' AND queued_at > NOW(3) - INTERVAL 1 HOUR",
            [$userId, $conferenceId],
        );
        if ((int) ($recent['n'] ?? 0) >= 3) {
            throw new AppError(429, 'Your ticket was already emailed several times in the last hour. Please check your inbox and spam folder.');
        }
        Db::tx($userId, static function (Connection $conn) use ($conferenceId, $userId, $ctx): void {
            $id = self::queueTicketEmail($conn, $conferenceId, $userId);
            if ($id === null) {
                throw new NotFoundError('You do not have an active registration for this conference.');
            }
            Audit::insert($conn, [
                'actorUserId' => $userId,
                'conferenceId' => $conferenceId,
                'action' => 'registration.ticket_emailed',
                'entityType' => 'users',
                'entityId' => $userId,
                'ipAddress' => $ctx['ipAddress'] ?? null,
                'userAgent' => $ctx['userAgent'] ?? null,
            ]);
        });
    }
}
