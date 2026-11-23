<?php

declare(strict_types=1);

namespace App\Email;

use App\Core\JsString;
use App\Core\Json;
use App\Db\Connection;

/** Port of utils/email.ts: emails are never sent inline, they are queued in email_logs. */
final class EmailQueue
{
    /**
     * @param array{userId: ?string, conferenceId?: ?string, recipientEmail: string, templateKey: string,
     *   subject: string, templateData: array<string,mixed>, entityType?: ?string, entityId?: ?string} $input
     */
    public static function queue(Connection $conn, array $input): int
    {
        $subject = $input['subject'];
        $data = $input['templateData'];
        $conferenceId = $input['conferenceId'] ?? null;
        if ($conferenceId
            && (preg_match('/\{\{conference_(code|name)\}\}/', $subject)
                || ($data['conference_code'] ?? null) === null || ($data['conference_name'] ?? null) === null)
        ) {
            $conference = $conn->first('SELECT code, name FROM conferences WHERE id = ? LIMIT 1', [$conferenceId]);
            if ($conference !== null) {
                $data = array_merge($data, [
                    'conference_code' => $data['conference_code'] ?? $conference['code'],
                    'conference_name' => $data['conference_name'] ?? $conference['name'],
                ]);
                $subject = self::render($subject, $data);
            }
        }

        if ($conferenceId && $input['templateKey'] !== 'bulk_email') {
            $custom = $conn->first(
                'SELECT subject FROM email_templates WHERE conference_id = ? AND template_key = ? AND is_active = TRUE LIMIT 1',
                [$conferenceId, $input['templateKey']],
            );
            if ($custom !== null && \App\Core\Js::truthy($custom['subject'])) {
                $subject = self::render($custom['subject'], $data);
            }
        }

        $result = $conn->run(
            "INSERT INTO email_logs (conference_id, user_id, recipient_email, template_key, subject, template_data, entity_type, entity_id, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued')",
            [
                $conferenceId,
                $input['userId'],
                $input['recipientEmail'],
                $input['templateKey'],
                $subject,
                Json::encode($data === [] ? Json::obj() : $data),
                $input['entityType'] ?? null,
                $input['entityId'] ?? null,
            ],
        );
        return $result->insertId;
    }

    /** renderTemplate: {{key}} -> String(value); missing/null placeholders are left as-is. */
    public static function render(string $template, array $data): string
    {
        return (string) preg_replace_callback('/\{\{(\w+)\}\}/', static function ($m) use ($data) {
            $v = $data[$m[1]] ?? null;
            return $v === null || Json::isUndef($v) ? $m[0] : JsString::from($v);
        }, $template);
    }
}
