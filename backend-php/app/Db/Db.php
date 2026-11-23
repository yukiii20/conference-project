<?php

declare(strict_types=1);

namespace App\Db;

use App\Core\Env;

/**
 * Port of server/src/db/pool.ts + withTransaction.ts.
 *
 * Node had a pool: `pool.query()` ran on any free connection (autocommit) and
 * `withTransaction()` took its own connection for the transaction. Code that calls
 * `pool.query()` inside a transaction callback therefore ran OUTSIDE that transaction.
 * This class keeps the same semantics: Db::pool() is the autocommit connection and every
 * Db::tx() takes a separate connection, so nested/parallel transactions stay independent.
 */
final class Db
{
    private static ?Connection $pool = null;

    /** @var list<Connection> idle transaction connections, reused within one process */
    private static array $idle = [];

    private static int $opened = 0;

    public static function pool(): Connection
    {
        return self::$pool ??= self::connect();
    }

    /** Shorthand for Db::pool()->query(). @return list<array<string,mixed>> */
    public static function query(string $sql, array $params = []): array
    {
        return self::pool()->query($sql, $params);
    }

    public static function run(string $sql, array $params = []): Result
    {
        return self::pool()->run($sql, $params);
    }

    /**
     * Begins a transaction, sets @app_user_id so the triggers (status history, audit
     * trails) can record who made the change, runs $fn, then commits or rolls back.
     * $userId may be null for actions with no signed-in actor.
     *
     * @template T
     * @param callable(Connection): T $fn
     * @return T
     */
    public static function tx(?string $userId, callable $fn): mixed
    {
        $conn = array_pop(self::$idle) ?? self::connect();
        try {
            $conn->begin();
            $conn->run('SET @app_user_id = ?', [$userId]);
            $result = $fn($conn);
            $conn->commit();
            return $result;
        } catch (\Throwable $e) {
            try {
                $conn->rollback();
            } catch (\Throwable) {
                // The connection is unusable; drop it instead of returning it to the idle list.
                $conn = null;
            }
            throw $e;
        } finally {
            if ($conn !== null) {
                try {
                    // A later autocommit statement on this connection must never inherit the actor.
                    $conn->run('SET @app_user_id = NULL');
                    self::$idle[] = $conn;
                } catch (\Throwable) {
                }
            }
        }
    }

    /** A fresh dedicated connection (email worker claims, jobs). */
    public static function connection(): Connection
    {
        return array_pop(self::$idle) ?? self::connect();
    }

    public static function release(Connection $conn): void
    {
        self::$idle[] = $conn;
    }

    public static function connect(): Connection
    {
        $env = Env::all();
        $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $env['DB_HOST'], $env['DB_PORT'], $env['DB_NAME']);
        $options = [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
            // Client-side placeholder substitution, like mysql2's pool.query(): typed
            // values (ints stay ints, LIMIT ? works) and native result types.
            \PDO::ATTR_EMULATE_PREPARES => true,
            \PDO::ATTR_STRINGIFY_FETCHES => false,
            // mysql2 connects with CLIENT_FOUND_ROWS: affectedRows counts matched rows,
            // so `affectedRows === 1` checks after a no-op UPDATE behave the same.
            \PDO::MYSQL_ATTR_FOUND_ROWS => true,
        ];
        if ($env['DB_SSL']) {
            $caPath = $env['DB_SSL_CA_PATH'];
            if ($env['DB_SSL_CA']) {
                $caPath = sys_get_temp_dir() . '/cms-db-ca-' . sha1($env['DB_SSL_CA']) . '.pem';
                if (!is_file($caPath)) {
                    file_put_contents($caPath, $env['DB_SSL_CA']);
                }
            }
            $options[\PDO::MYSQL_ATTR_SSL_CA] = $caPath;
            $options[\PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT] = true;
        }
        $pdo = new \PDO($dsn, $env['DB_USER'], $env['DB_PASSWORD'], $options);
        // Every connection runs in UTC (DATETIME columns are UTC; display converts to Asia/Kathmandu).
        // utf8mb4_unicode_ci is mysql2's default connection collation.
        $pdo->exec("SET time_zone = '+00:00', NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
        self::$opened++;
        return new Connection($pdo);
    }

    public static function openedConnections(): int
    {
        return self::$opened;
    }

    /** Closes everything (end of a CLI job, or tests switching databases). */
    public static function closeAll(): void
    {
        self::$pool = null;
        self::$idle = [];
    }
}
