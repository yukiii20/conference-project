<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Http\JsonObject;
use App\Http\Req;
use App\Validation\Schema;
use App\Validation\Z;

/** Port of middleware/validate.ts: replaces req.body / req.query with the parsed data, or 400. */
final class Validate
{
    public static function body(Schema $schema): \Closure
    {
        return static function (Req $req, callable $next) use ($schema) {
            $req->body = Z::parseOrFail($schema, $req->body);
            return $next($req);
        };
    }

    /** req.query is always an object in Express (qs), even when empty. */
    public static function query(Schema $schema): \Closure
    {
        return static function (Req $req, callable $next) use ($schema) {
            $q = new JsonObject();
            foreach ($req->query as $k => $v) {
                $q[$k] = $v;
            }
            $req->query = Z::parseOrFail($schema, $q);
            return $next($req);
        };
    }
}
