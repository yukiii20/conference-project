<?php

declare(strict_types=1);

namespace App\Support;

use App\Db\Connection;

/** Port of utils/notifications.ts. */
final class Notifications
{
    /**
     * @param array{userId: string, conferenceId?: ?string, type: string, title: string, body?: ?string,
     *   linkPath?: ?string, entityType?: ?string, entityId?: ?string} $n
     */
    public static function notifyUser(Connection $conn, array $n): void
    {
        $conn->run(
            'INSERT INTO notifications (user_id, conference_id, type, title, body, link_path, entity_type, entity_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $n['userId'],
                $n['conferenceId'] ?? null,
                $n['type'],
                $n['title'],
                $n['body'] ?? null,
                $n['linkPath'] ?? null,
                $n['entityType'] ?? null,
                $n['entityId'] ?? null,
            ],
        );
    }
}
