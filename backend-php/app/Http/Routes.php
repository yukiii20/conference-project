<?php

declare(strict_types=1);

namespace App\Http;

use App\Db\Db;
use App\Http\Middleware\RateLimit;
use App\Storage\FileSend;
use App\Storage\Storage;

/**
 * The mount table of server/src/app.ts, in the same order (order decides which router wins an
 * ambiguous path, e.g. /public-deadlines before /:slug). Each entry is
 * [prefix, mount-level middleware, Router]. Modules are added here as they are ported.
 */
final class Routes
{
    /** @var list<array{0: string, 1: list<callable>, 2: Router}>|null */
    private ?array $mounts = null;

    private static ?int $startedAt = null;

    public static function markStarted(): void
    {
        self::$startedAt ??= (int) floor(microtime(true) * 1000);
    }

    /** @return list<array{0: string, 1: list<callable>, 2: Router}> */
    public function mounts(): array
    {
        return $this->mounts ??= $this->build();
    }

    private function build(): array
    {
        $app = new Router();
        $app->get('/files/public/*', FileSend::publicFileHandler(...));
        $app->get('/api/health', self::health(...));

        $m = [['', [], $app]];
        $add = static function (string $prefix, string $class, string $method = 'router', array $middleware = []) use (&$m): void {
            if (class_exists($class)) {
                $m[] = [$prefix, $middleware, $class::$method()];
            }
        };

        $add('/api/webhooks', 'App\\Modules\\EmailWebhooks\\EmailWebhookRoutes', 'router', [RateLimit::machine()]);
        $add('/api/internal', 'App\\Jobs\\TickRoutes', 'router', [RateLimit::machine()]);
        $add('/api/auth', 'App\\Modules\\Auth\\AuthRoutes');
        $add('/api/invitations', 'App\\Modules\\Invitations\\InvitationRoutes');
        $add('/api/conferences', 'App\\Modules\\Conferences\\PublicExtrasRoutes');
        $add('/api/conferences', 'App\\Modules\\Conferences\\ConferenceRoutes');
        $add('/api/conferences', 'App\\Modules\\Conferences\\ManageRoutes');
        $add('/api/conferences', 'App\\Modules\\RoleRequests\\RoleRequestRoutes', 'conferenceRouter');
        $add('/api/conferences', 'App\\Modules\\Deadlines\\DeadlineRoutes');
        $add('/api/conferences', 'App\\Modules\\Tracks\\TrackRoutes');
        $add('/api/conferences', 'App\\Modules\\Supporters\\SupporterRoutes');
        $add('/api/conferences', 'App\\Modules\\Schedule\\ScheduleRoutes');
        $add('/api/conferences', 'App\\Modules\\SessionTimer\\SessionTimerRoutes');
        $add('/api/conferences', 'App\\Modules\\AbstractBook\\AbstractBookRoutes');
        $add('/api/conferences', 'App\\Modules\\Feedback\\FeedbackRoutes');
        $add('/api/conferences', 'App\\Modules\\Settings\\SettingsRoutes');
        $add('/api/conferences', 'App\\Modules\\Submissions\\SubmissionRoutes', 'conferenceRouter');
        $add('/api/conferences', 'App\\Modules\\Reviews\\ReviewRoutes', 'conferenceRouter');
        $add('/api/conferences', 'App\\Modules\\Emails\\EmailRoutes', 'conferenceRouter');
        $add('/api/conferences', 'App\\Modules\\Dashboard\\DashboardRoutes');
        $add('/api/conferences', 'App\\Modules\\Members\\MemberRoutes');
        $add('/api/conferences', 'App\\Modules\\Committees\\CommitteeRoutes');
        $add('/api/conferences', 'App\\Modules\\Speakers\\SpeakerRoutes');
        $add('/api/conferences', 'App\\Modules\\Announcements\\AnnouncementRoutes', 'conferenceRouter');
        $add('/api/conferences', 'App\\Modules\\BulkEmail\\BulkEmailRoutes');
        $add('/api/conferences', 'App\\Modules\\EmailTemplates\\EmailTemplateRoutes');
        $add('/api/conferences', 'App\\Modules\\Reports\\ReportRoutes');
        $add('/api/conferences', 'App\\Modules\\ActivityLog\\ActivityLogRoutes');
        $add('/api/conferences', 'App\\Modules\\Registration\\RegistrationRoutes');
        $add('/api/conferences', 'App\\Modules\\Audience\\AudienceRoutes');
        $add('/api/conferences', 'App\\Modules\\Publication\\PublicationRoutes');
        $add('/api/conferences', 'App\\Modules\\Archive\\ArchiveRoutes');
        $add('/api/conferences', 'App\\Modules\\PostConference\\PostConferenceRoutes');
        $add('/api/conferences', 'App\\Modules\\Registration\\ReceiptRoutes');
        $add('/api/conferences', 'App\\Modules\\Badges\\BadgeRoutes');
        $add('/api/conferences', 'App\\Modules\\Analytics\\AnalyticsRoutes');
        $add('/api/admin', 'App\\Modules\\Analytics\\AnalyticsRoutes', 'platformRouter');
        $add('/api/conferences', 'App\\Modules\\Certificates\\CertificateRoutes');
        $add('/api', 'App\\Modules\\Certificates\\CertificateRoutes', 'publicRouter');
        $add('/api/submissions', 'App\\Modules\\Submissions\\SubmissionRoutes');
        $add('/api/reviewer', 'App\\Modules\\Reviews\\ReviewRoutes', 'reviewerRouter');
        $add('/api/role-requests', 'App\\Modules\\RoleRequests\\RoleRequestRoutes');
        $add('/api', 'App\\Modules\\PlatformSettings\\PlatformSettingsRoutes', 'publicRouter');
        $add('/api', 'App\\Modules\\Suggestions\\SuggestionRoutes', 'publicRouter');
        $add('/api', 'App\\Modules\\Agenda\\AgendaRoutes');
        $add('/api', 'App\\Modules\\Agenda\\AgendaRoutes', 'feedRouter');
        $add('/api', 'App\\Modules\\Feedback\\FeedbackRoutes', 'meRouter');
        $add('/api/admin', 'App\\Modules\\Admin\\AdminRoutes');
        $add('/api/admin', 'App\\Modules\\Emails\\EmailRoutes', 'adminRouter');
        $add('/api/admin', 'App\\Modules\\PlatformSettings\\PlatformSettingsRoutes', 'adminRouter');
        $add('/api/admin', 'App\\Modules\\Suggestions\\SuggestionRoutes', 'adminRouter');
        $add('/api/me', 'App\\Modules\\Me\\MeRoutes');
        $add('/api/announcements', 'App\\Modules\\Announcements\\AnnouncementRoutes');
        return $m;
    }

    /** GET /api/health: operational counts only, never user data or secrets. */
    private static function health(Req $req): \Symfony\Component\HttpFoundation\Response
    {
        $db = ['ok' => false, 'latency_ms' => null];
        $t = microtime(true);
        try {
            Db::query('SELECT 1');
            $db = ['ok' => true, 'latency_ms' => (int) round((microtime(true) - $t) * 1000)];
        } catch (\Throwable) {
        }
        $email = ['queued' => null, 'failed_24h' => null];
        try {
            $row = Db::pool()->first(
                "SELECT SUM(status = 'queued') AS queued,
                        SUM(status = 'failed' AND queued_at >= NOW(3) - INTERVAL 24 HOUR) AS failed_24h
                 FROM email_logs",
            );
            $email = [
                'queued' => $row['queued'] !== null ? (int) $row['queued'] : 0,
                'failed_24h' => $row['failed_24h'] !== null ? (int) $row['failed_24h'] : 0,
            ];
        } catch (\Throwable) {
        }
        self::markStarted();
        $uptime = self::processStartMs();
        return Res::json([
            'ok' => $db['ok'],
            'uptime_seconds' => (int) round(((int) floor(microtime(true) * 1000) - $uptime) / 1000),
            'database' => $db,
            'email_queue' => $email,
            'storage' => Storage::driver()->name(),
        ], $db['ok'] ? 200 : 503);
    }

    /**
     * Node measured uptime from its own start. PHP-FPM has no single process lifetime, so the
     * start time is the container's boot, recorded once in a file by the entrypoint (or the
     * first request when that file is missing).
     */
    private static function processStartMs(): int
    {
        $file = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'cms-php-started-at';
        $v = @file_get_contents($file);
        if ($v !== false && ctype_digit(trim($v))) {
            return (int) trim($v);
        }
        $now = (int) floor(microtime(true) * 1000);
        @file_put_contents($file, (string) $now);
        return $now;
    }
}
