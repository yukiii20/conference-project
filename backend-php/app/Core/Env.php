<?php

declare(strict_types=1);

namespace App\Core;

/**
 * Port of server/src/config/env.ts: the same variable names, defaults and refusal rules,
 * so the Render dashboard values carry over unchanged. NODE_ENV is still the switch for
 * development/test/production (APP_ENV is read only when NODE_ENV is absent).
 */
final class Env
{
    /** @var array<string,mixed>|null */
    private static ?array $values = null;

    private const WEAK_SESSION_SECRETS = ['changeme', 'change-me', 'secret', 'dev-secret', 'development'];

    public static function raw(string $key): ?string
    {
        $v = $_SERVER[$key] ?? $_ENV[$key] ?? getenv($key);
        if ($v === false || $v === null) {
            return null;
        }
        return (string) $v;
    }

    /** @return array<string,mixed> */
    public static function all(): array
    {
        if (self::$values === null) {
            [$values, $issues] = self::parse();
            if ($issues !== []) {
                $lines = ['Invalid environment configuration:'];
                foreach ($issues as [$path, $message]) {
                    $lines[] = "  {$path}: {$message}";
                }
                fwrite(STDERR, implode("\n", $lines) . "\n");
                exit(1);
            }
            self::$values = $values;
        }
        return self::$values;
    }

    public static function get(string $key): mixed
    {
        return self::all()[$key] ?? null;
    }

    public static function isProduction(): bool
    {
        return self::get('NODE_ENV') === 'production';
    }

    public static function isTest(): bool
    {
        return self::get('NODE_ENV') === 'test';
    }

    /** For tests: override values after parsing. */
    public static function override(array $values): void
    {
        self::all();
        self::$values = array_merge(self::$values, $values);
    }

    public static function reset(): void
    {
        self::$values = null;
    }

    /** @return array{0: array<string,mixed>, 1: list<array{0:string,1:string}>} */
    public static function parse(): array
    {
        $issues = [];
        $v = [];
        $str = fn (string $k): ?string => self::raw($k);
        $nonEmpty = function (string $k) use (&$issues, $str): string {
            $x = $str($k);
            if ($x === null) {
                $issues[] = [$k, 'Invalid input: expected string, received undefined'];
                return '';
            }
            if ($x === '') {
                $issues[] = [$k, 'Too small: expected string to have >=1 characters'];
            }
            return $x;
        };
        $posInt = function (string $k, ?int $default) use (&$issues, $str): ?int {
            $x = $str($k);
            if ($x === null) {
                return $default;
            }
            $n = JsNumber::from($x);
            if (!is_finite($n) || floor($n) !== $n || $n <= 0) {
                $issues[] = [$k, 'Invalid input'];
                return $default;
            }
            return (int) $n;
        };
        $bool = fn (string $k): bool => $str($k) === 'true';
        $optionalSecret = function (string $k) use (&$issues, $str): ?string {
            $x = $str($k);
            if ($x === null || $x === '') {
                return null;
            }
            if (strlen($x) < 24) {
                $issues[] = [$k, "{$k} must be at least 24 characters."];
            }
            return $x;
        };
        $url = function (string $k, ?string $default) use (&$issues, $str): ?string {
            $x = $str($k);
            if ($x === null) {
                return $default;
            }
            if (!preg_match('#^[a-z][a-z0-9+.-]*://[^\s/?\#]+#i', $x)) {
                $issues[] = [$k, 'Invalid URL'];
            }
            return $x;
        };

        $v['DB_HOST'] = $nonEmpty('DB_HOST');
        $v['DB_PORT'] = $posInt('DB_PORT', 3306);
        $v['DB_USER'] = $nonEmpty('DB_USER');
        $v['DB_PASSWORD'] = $nonEmpty('DB_PASSWORD');
        $v['DB_NAME'] = $nonEmpty('DB_NAME');
        $v['DB_POOL_SIZE'] = $posInt('DB_POOL_SIZE', 20);
        $v['DB_SSL'] = $bool('DB_SSL');
        $v['DB_SSL_CA'] = $str('DB_SSL_CA');
        $v['DB_SSL_CA_PATH'] = $str('DB_SSL_CA_PATH');

        $secret = $str('SESSION_SECRET');
        if ($secret === null || strlen($secret) < 16) {
            $issues[] = ['SESSION_SECRET', 'SESSION_SECRET must be at least 16 characters.'];
        }
        $v['SESSION_SECRET'] = $secret ?? '';

        $v['CLIENT_ORIGIN'] = $url('CLIENT_ORIGIN', null);
        if ($v['CLIENT_ORIGIN'] === null) {
            $issues[] = ['CLIENT_ORIGIN', 'Invalid input: expected string, received undefined'];
        }
        $v['PORT'] = $posInt('PORT', 4000);

        $nodeEnv = $str('NODE_ENV') ?? self::mapAppEnv($str('APP_ENV')) ?? 'development';
        if (!in_array($nodeEnv, ['development', 'test', 'production'], true)) {
            $issues[] = ['NODE_ENV', 'Invalid option: expected one of "development"|"test"|"production"'];
        }
        $v['NODE_ENV'] = $nodeEnv;
        $v['TRUST_PROXY'] = $str('TRUST_PROXY');

        $mode = $str('EMAIL_MODE') ?? 'console';
        if (!in_array($mode, ['console', 'smtp', 'brevo'], true)) {
            $issues[] = ['EMAIL_MODE', 'Invalid option: expected one of "console"|"smtp"|"brevo"'];
        }
        $v['EMAIL_MODE'] = $mode;
        $v['SMTP_HOST'] = $str('SMTP_HOST');
        $v['SMTP_PORT'] = $posInt('SMTP_PORT', null);
        $v['SMTP_SECURE'] = $bool('SMTP_SECURE');
        $v['SMTP_USER'] = $str('SMTP_USER');
        $v['SMTP_PASS'] = $str('SMTP_PASS');
        $v['MAIL_FROM'] = $str('MAIL_FROM');
        $v['BREVO_API_KEY'] = $str('BREVO_API_KEY');
        $v['CRON_SECRET'] = $optionalSecret('CRON_SECRET');
        $v['BREVO_WEBHOOK_SECRET'] = $optionalSecret('BREVO_WEBHOOK_SECRET');
        $v['APP_URL'] = $url('APP_URL', 'http://localhost:5173');
        $v['STORAGE_DIR'] = $str('STORAGE_DIR') ?: ($str('STORAGE_ROOT') ?: null);

        $driver = $str('STORAGE_DRIVER') ?? 'local';
        if (!in_array($driver, ['local', 's3', 'r2'], true)) {
            $issues[] = ['STORAGE_DRIVER', 'Invalid option: expected one of "local"|"s3"|"r2"'];
        }
        $v['STORAGE_DRIVER'] = $driver;
        $v['S3_ENDPOINT'] = ($str('S3_ENDPOINT') ?? '') === '' ? null : $url('S3_ENDPOINT', null);
        foreach (['S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'R2_ACCOUNT_ID',
            'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as $k) {
            $v[$k] = $str($k);
        }
        $fps = $str('S3_FORCE_PATH_STYLE');
        $v['S3_FORCE_PATH_STYLE'] = ($fps === '' ? null : $fps);
        if ($v['S3_FORCE_PATH_STYLE'] !== null && !in_array($v['S3_FORCE_PATH_STYLE'], ['true', 'false'], true)) {
            $issues[] = ['S3_FORCE_PATH_STYLE', 'Invalid option: expected one of "true"|"false"'];
        }
        $v['RATE_LIMIT_STORE'] = $str('RATE_LIMIT_STORE') ?: (function_exists('apcu_fetch') ? 'apcu' : 'file');
        $v['LOG_LEVEL'] = $str('LOG_LEVEL') ?: 'info';

        // superRefine rules, same order and messages as env.ts.
        if ($mode === 'smtp') {
            foreach (['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'] as $k) {
                if (!$v[$k]) {
                    $issues[] = [$k, "{$k} is required when EMAIL_MODE=smtp."];
                }
            }
        }
        if ($mode === 'brevo') {
            if (!$v['BREVO_API_KEY']) {
                $issues[] = ['BREVO_API_KEY', 'BREVO_API_KEY is required when EMAIL_MODE=brevo.'];
            }
            if (!$v['MAIL_FROM']) {
                $issues[] = ['MAIL_FROM', 'MAIL_FROM is required when EMAIL_MODE=brevo (must be a Brevo-verified sender).'];
            }
        }
        if ($driver === 's3' || $driver === 'r2') {
            $s3Complete = $v['S3_BUCKET'] && $v['S3_ACCESS_KEY_ID'] && $v['S3_SECRET_ACCESS_KEY'];
            $r2Complete = $v['R2_ACCOUNT_ID'] && $v['R2_BUCKET'] && $v['R2_ACCESS_KEY_ID'] && $v['R2_SECRET_ACCESS_KEY'];
            if (!$s3Complete && !$r2Complete) {
                foreach (['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as $k) {
                    if (!$v[$k]) {
                        $issues[] = [$k, "{$k} is required when STORAGE_DRIVER={$driver}."];
                    }
                }
            }
            if ($s3Complete && !$v['S3_ENDPOINT'] && !$v['S3_REGION']) {
                $issues[] = ['S3_REGION', 'Set S3_ENDPOINT (R2, B2, MinIO) or S3_REGION (AWS S3).'];
            }
        }
        if ($v['DB_SSL'] && !$v['DB_SSL_CA'] && !$v['DB_SSL_CA_PATH']) {
            $issues[] = ['DB_SSL_CA', 'DB_SSL_CA (or DB_SSL_CA_PATH) is required when DB_SSL=true.'];
        }
        if ($nodeEnv === 'production') {
            if (strlen($v['SESSION_SECRET']) < 32 || in_array(strtolower($v['SESSION_SECRET']), self::WEAK_SESSION_SECRETS, true)) {
                $issues[] = ['SESSION_SECRET', 'SESSION_SECRET must be a strong, unique value (32+ characters) in production.'];
            }
            if (!str_starts_with((string) $v['CLIENT_ORIGIN'], 'https://')) {
                $issues[] = ['CLIENT_ORIGIN', 'CLIENT_ORIGIN must use https:// in production.'];
            }
            if (!str_starts_with((string) $v['APP_URL'], 'https://')) {
                $issues[] = ['APP_URL', 'APP_URL must use https:// in production.'];
            }
        }
        return [$v, $issues];
    }

    private static function mapAppEnv(?string $appEnv): ?string
    {
        return match ($appEnv) {
            'production' => 'production',
            'testing', 'test' => 'test',
            'local', 'development' => 'development',
            default => null,
        };
    }
}
