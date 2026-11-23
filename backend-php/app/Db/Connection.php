<?php

declare(strict_types=1);

namespace App\Db;

use App\Core\DbError;
use App\Core\Json;
use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;

/**
 * One MySQL connection, with mysql2-compatible placeholder handling and result typing:
 *
 * Placeholders (mysql2 / sqlstring rules, but always bound as prepared-statement params):
 *   scalar        -> ?
 *   list          -> ?, ?, ?          (for `IN (?)`)
 *   list of lists -> (?, ?), (?, ?)   (for bulk `VALUES ?`)
 *   bool          -> 1 / 0            DateTimeInterface -> 'Y-m-d H:i:s.v' in UTC (timezone: 'Z')
 *
 * Result typing (what mysql2 returned with dateStrings: ['DATE'], timezone: 'Z'):
 *   INT/BIGINT/COUNT -> int, DOUBLE/FLOAT -> float, DECIMAL/SUM/AVG -> string,
 *   DATETIME/TIMESTAMP -> DateTimeImmutable (UTC), DATE/TIME -> string, JSON -> decoded (objects as stdClass).
 */
final class Connection
{
    private static ?DateTimeZone $utc = null;

    public function __construct(private \PDO $pdo)
    {
    }

    public function pdo(): \PDO
    {
        return $this->pdo;
    }

    /** SELECT (or anything returning rows). @return list<array<string,mixed>> */
    public function query(string $sql, array $params = []): array
    {
        $stmt = $this->execute($sql, $params);
        if ($stmt->columnCount() === 0) {
            return [];
        }
        return $this->typedRows($stmt);
    }

    /** First row or null. @return array<string,mixed>|null */
    public function first(string $sql, array $params = []): ?array
    {
        return $this->query($sql, $params)[0] ?? null;
    }

    /** INSERT/UPDATE/DELETE. */
    public function run(string $sql, array $params = []): Result
    {
        $stmt = $this->execute($sql, $params);
        $affected = $stmt->rowCount();
        $stmt->closeCursor();
        $insertId = (int) $this->pdo->lastInsertId();
        return new Result($affected, $insertId);
    }

    public function begin(): void
    {
        $this->wrap(fn () => $this->pdo->beginTransaction());
    }

    public function commit(): void
    {
        $this->wrap(fn () => $this->pdo->commit());
    }

    public function rollback(): void
    {
        if ($this->pdo->inTransaction()) {
            $this->pdo->rollBack();
        }
    }

    public function inTransaction(): bool
    {
        return $this->pdo->inTransaction();
    }

    private function execute(string $sql, array $params): \PDOStatement
    {
        [$expanded, $values] = self::expand($sql, $params);
        return $this->wrap(function () use ($expanded, $values) {
            $stmt = $this->pdo->prepare($expanded);
            foreach ($values as $i => $v) {
                $stmt->bindValue($i + 1, $v, match (true) {
                    is_int($v) => \PDO::PARAM_INT,
                    $v === null => \PDO::PARAM_NULL,
                    default => \PDO::PARAM_STR,
                });
            }
            $stmt->execute();
            return $stmt;
        });
    }

    /**
     * @template T
     * @param callable(): T $fn
     * @return T
     */
    private function wrap(callable $fn): mixed
    {
        try {
            return $fn();
        } catch (\PDOException $e) {
            $info = $e->errorInfo ?? [];
            $sqlState = (string) ($info[0] ?? $e->getCode());
            $errno = (int) ($info[1] ?? 0);
            $message = (string) ($info[2] ?? $e->getMessage());
            throw new DbError($errno, $sqlState, $message, $e);
        }
    }

    /**
     * Expands mysql2-style placeholders into plain `?` with a flat value list.
     *
     * @return array{0: string, 1: list<mixed>}
     */
    public static function expand(string $sql, array $params): array
    {
        $params = array_values($params);
        $out = '';
        $values = [];
        $index = 0;
        $len = strlen($sql);
        $quote = null;
        for ($i = 0; $i < $len; $i++) {
            $ch = $sql[$i];
            if ($quote !== null) {
                $out .= $ch;
                if ($ch === '\\' && $quote !== '`' && $i + 1 < $len) {
                    $out .= $sql[++$i];
                } elseif ($ch === $quote) {
                    $quote = null;
                }
                continue;
            }
            if ($ch === "'" || $ch === '"' || $ch === '`') {
                $quote = $ch;
                $out .= $ch;
                continue;
            }
            if ($ch === '-' && ($sql[$i + 1] ?? '') === '-' && in_array($sql[$i + 2] ?? ' ', [' ', "\t", "\n", "\r"], true)) {
                $end = strpos($sql, "\n", $i);
                $end = $end === false ? $len : $end;
                $out .= substr($sql, $i, $end - $i);
                $i = $end - 1;
                continue;
            }
            if ($ch !== '?') {
                $out .= $ch;
                continue;
            }
            if (!array_key_exists($index, $params)) {
                // mysql2 leaves surplus placeholders as-is (MySQL then reports a syntax error).
                $out .= '?';
                continue;
            }
            $value = $params[$index++];
            if (is_array($value) && array_is_list($value)) {
                if ($value === []) {
                    // sqlstring renders [] as an empty string; `IN ()` is then a MySQL syntax error, as in Node.
                    continue;
                }
                $parts = [];
                foreach ($value as $item) {
                    if (is_array($item) && array_is_list($item)) {
                        $inner = [];
                        foreach ($item as $x) {
                            $inner[] = '?';
                            $values[] = self::scalar($x);
                        }
                        $parts[] = '(' . implode(', ', $inner) . ')';
                    } else {
                        $parts[] = '?';
                        $values[] = self::scalar($item);
                    }
                }
                $out .= implode(', ', $parts);
                continue;
            }
            $out .= '?';
            $values[] = self::scalar($value);
        }
        return [$out, $values];
    }

    private static function scalar(mixed $v): mixed
    {
        if ($v === null || Json::isUndef($v)) {
            return null;
        }
        if (is_bool($v)) {
            return $v ? 1 : 0;
        }
        if (is_int($v) || is_string($v)) {
            return $v;
        }
        if (is_float($v)) {
            if (is_nan($v) || is_infinite($v)) {
                return null;
            }
            return floor($v) === $v && abs($v) < 9.2e18 ? (int) $v : (string) $v;
        }
        if ($v instanceof DateTimeInterface) {
            return DateTimeImmutable::createFromInterface($v)->setTimezone(self::utc())->format('Y-m-d H:i:s.v');
        }
        if ($v instanceof \stdClass || is_array($v)) {
            // sqlstring would render an object as `key` = value pairs; this codebase always
            // JSON.stringify()s objects before binding, so anything reaching here is a bug.
            throw new \InvalidArgumentException('Objects must be JSON-encoded before binding.');
        }
        return (string) $v;
    }

    /** @return list<array<string,mixed>> */
    private function typedRows(\PDOStatement $stmt): array
    {
        $count = $stmt->columnCount();
        $casts = [];
        for ($i = 0; $i < $count; $i++) {
            $meta = $stmt->getColumnMeta($i) ?: [];
            $type = strtoupper((string) ($meta['native_type'] ?? ''));
            $name = (string) ($meta['name'] ?? $i);
            $cast = match ($type) {
                'DATETIME', 'TIMESTAMP' => 'datetime',
                'JSON' => 'json',
                'LONGLONG', 'LONG', 'SHORT', 'TINY', 'INT24', 'YEAR' => 'int',
                'DOUBLE', 'FLOAT' => 'float',
                default => null,
            };
            if ($cast !== null) {
                $casts[$name] = $cast;
            }
        }
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);
        $stmt->closeCursor();
        if ($casts === []) {
            return $rows;
        }
        foreach ($rows as &$row) {
            foreach ($casts as $name => $cast) {
                $v = $row[$name] ?? null;
                if ($v === null) {
                    continue;
                }
                $row[$name] = match ($cast) {
                    'datetime' => self::parseDate((string) $v),
                    'json' => is_string($v) ? Json::decode($v) : $v,
                    'int' => is_int($v) ? $v : (int) $v,
                    'float' => is_float($v) ? $v : (float) $v,
                };
            }
        }
        unset($row);
        return $rows;
    }

    public static function parseDate(string $v): ?DateTimeImmutable
    {
        if (str_starts_with($v, '0000-00-00')) {
            return null;
        }
        $format = str_contains($v, '.') ? 'Y-m-d H:i:s.u' : 'Y-m-d H:i:s';
        $d = DateTimeImmutable::createFromFormat($format, $v, self::utc());
        return $d === false ? null : $d;
    }

    public static function utc(): DateTimeZone
    {
        return self::$utc ??= new DateTimeZone('UTC');
    }
}
