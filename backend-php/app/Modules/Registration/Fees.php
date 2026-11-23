<?php

declare(strict_types=1);

namespace App\Modules\Registration;

use App\Core\ConflictError;
use App\Core\JsNumber;
use App\Db\Connection;
use App\Support\Crypto;

/** The price lookups from modules/registration/fees.service.ts (the CRUD part is ported with the registration module). */
final class Fees
{
    /** Sum of successful payments minus refunds (reused in list queries). */
    public const AMOUNT_PAID_SQL = "(SELECT COALESCE(SUM(p.amount - p.refunded_amount), 0) FROM payments p WHERE p.registration_id = r.id AND p.status = 'successful')";

    /** The active price covering $at (default now), amount as a JS number. */
    public static function currentFeeFor(Connection $db, string $categoryId, ?\DateTimeInterface $at = null): ?array
    {
        $at ??= Crypto::now();
        $row = $db->first(
            'SELECT id, amount, currency, fee_type, valid_until FROM registration_fees
             WHERE category_id = ? AND is_active = TRUE AND valid_from <= ? AND valid_until > ?
             ORDER BY valid_from DESC LIMIT 1',
            [$categoryId, $at, $at],
        );
        if ($row === null) {
            return null;
        }
        $row['amount'] = self::num($row['amount']);
        return $row;
    }

    public static function categoryHasActiveFees(Connection $db, string $categoryId): bool
    {
        return $db->query('SELECT 1 FROM registration_fees WHERE category_id = ? AND is_active = TRUE LIMIT 1', [$categoryId]) !== [];
    }

    /** @return array{feeId: ?string, amount: int|float, currency: string} */
    public static function priceForNewRegistration(Connection $conn, string $categoryId, string $defaultCurrency): array
    {
        $fee = self::currentFeeFor($conn, $categoryId);
        if ($fee !== null) {
            return ['feeId' => $fee['id'], 'amount' => $fee['amount'], 'currency' => $fee['currency']];
        }
        if (self::categoryHasActiveFees($conn, $categoryId)) {
            throw new ConflictError('There is no price for this category today. Please contact the organisers.');
        }
        return ['feeId' => null, 'amount' => 0, 'currency' => $defaultCurrency];
    }

    /** Number(decimalString) as int when whole. */
    public static function num(mixed $v): int|float
    {
        $n = JsNumber::from($v);
        return floor($n) === $n && abs($n) < 9007199254740992 ? (int) $n : $n;
    }
}
