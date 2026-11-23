<?php

declare(strict_types=1);

namespace App\Support;

use App\Core\Json;
use App\Db\Connection;
use App\Http\Req;

/** Port of utils/audit.ts. */
final class Audit
{
    /** auditContextFrom(req) */
    public static function context(Req $req): array
    {
        return ['ipAddress' => $req->ip, 'userAgent' => $req->header('user-agent')];
    }

    /**
     * @param array{actorUserId: ?string, conferenceId?: ?string, action: string, entityType: string,
     *   entityId?: ?string, oldValues?: mixed, newValues?: mixed, ipAddress?: ?string, userAgent?: ?string} $e
     */
    public static function insert(Connection $conn, array $e): void
    {
        $conn->run(
            'INSERT INTO audit_logs
               (actor_user_id, conference_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $e['actorUserId'],
                $e['conferenceId'] ?? null,
                $e['action'],
                $e['entityType'],
                $e['entityId'] ?? null,
                \App\Core\Js::truthy($e['oldValues'] ?? null) ? Json::encode($e['oldValues']) : null,
                \App\Core\Js::truthy($e['newValues'] ?? null) ? Json::encode($e['newValues']) : null,
                $e['ipAddress'] ?? null,
                $e['userAgent'] ?? null,
            ],
        );
    }
}
