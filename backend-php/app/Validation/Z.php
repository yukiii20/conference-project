<?php

declare(strict_types=1);

namespace App\Validation;

use App\Core\BadRequestError;

/**
 * The `z` namespace, so ported schemas read like the zod originals:
 *   Z::object(['name' => Z::string()->trim()->min(2, 'Too short.')])
 */
final class Z
{
    public static function string(string|array|null $params = null): StringSchema
    {
        return new StringSchema(self::err($params));
    }

    public static function number(string|array|null $params = null): NumberSchema
    {
        return new NumberSchema(false, self::err($params));
    }

    /** z.coerce.number() */
    public static function coerceNumber(string|array|null $params = null): NumberSchema
    {
        return new NumberSchema(true, self::err($params));
    }

    public static function boolean(string|array|null $params = null): BooleanSchema
    {
        return new BooleanSchema(self::err($params));
    }

    /** @param list<string> $values */
    public static function enum(array $values, string|array|null $params = null): EnumSchema
    {
        return new EnumSchema(array_values($values), self::err($params));
    }

    public static function literal(string|int|bool|null $value, string|array|null $params = null): EnumSchema
    {
        return new EnumSchema([$value], self::err($params));
    }

    public static function array(Schema $item, string|array|null $params = null): ArraySchema
    {
        return new ArraySchema($item, self::err($params));
    }

    /** @param array<string, Schema> $shape */
    public static function object(array $shape, string|array|null $params = null): ObjectSchema
    {
        return new ObjectSchema($shape, self::err($params));
    }

    /** @param list<Schema> $options */
    public static function union(array $options): UnionSchema
    {
        return new UnionSchema($options);
    }

    public static function any(): AnySchema
    {
        return new AnySchema();
    }

    public static function preprocess(callable $fn, Schema $schema): Schema
    {
        return Schema::preprocess($fn, $schema);
    }

    /** z.NEVER: return it from a transform after ctx->addIssue(). */
    public static function never(): \stdClass
    {
        return \App\Core\Json::undef();
    }

    /**
     * fieldsFromZodError + the BadRequestError validateBody/validateQuery throw.
     * Only string first-path-segments count; the first message per key wins.
     */
    public static function fieldsFromIssues(array $issues): array
    {
        $fields = [];
        foreach ($issues as $issue) {
            $key = $issue['path'][0] ?? null;
            if (is_string($key) && !array_key_exists($key, $fields)) {
                $fields[$key] = $issue['message'];
            }
        }
        return $fields;
    }

    /** Parses or throws the 400 the Node validate middleware produced. */
    public static function parseOrFail(Schema $schema, mixed $value): mixed
    {
        $r = $schema->safeParse($value);
        if (!$r['success']) {
            throw new BadRequestError('Please fix the highlighted fields.', self::fieldsFromIssues($r['issues']));
        }
        return $r['data'];
    }

    private static function err(string|array|null $params): ?string
    {
        if (is_array($params)) {
            return $params['error'] ?? $params['message'] ?? null;
        }
        return $params;
    }
}
