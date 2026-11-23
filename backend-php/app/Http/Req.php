<?php

declare(strict_types=1);

namespace App\Http;

use App\Auth\SessionUser;
use App\Core\BodyParseError;
use App\Core\Json;

/**
 * The Express `req` the Node handlers used, built from a Symfony request:
 *   method, path (raw, as req.path), originalUrl, params (decoded), query (qs-parsed),
 *   body (parsed JSON: arrays for objects; {} when there was no JSON body), headers, cookies,
 *   ip (trust-proxy aware), user (set by requireAuth), file (set by the upload middleware).
 */
final class Req
{
    public const BODY_LIMIT = 102400; // express.json({ limit: '100kb' })

    /** @var array<string,string> */
    public array $params = [];

    /** @var array<string,mixed> */
    public array $query;

    /** Parsed body. Objects are assoc arrays; validateBody replaces it with the schema output. */
    public mixed $body;

    /** True when the raw JSON body was an object (`{...}`), which z.object() needs to tell apart from `[...]`. */
    public bool $bodyIsObject = true;

    public ?SessionUser $user = null;

    public ?UploadedFile $file = null;

    /** @var array<string,mixed> free-form per-request values (rate-limit info, ...) */
    public array $locals = [];

    /** @param array<string,string> $headers lower-cased names */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly string $originalUrl,
        public readonly array $headers,
        public readonly array $cookies,
        public readonly string $ip,
        string $rawQuery,
        public readonly string $rawBody,
        /** @var array<string,mixed> */
        public readonly array $files = [],
        /** @var array<string,mixed> */
        public readonly array $postFields = [],
    ) {
        $this->query = QueryString::parse($rawQuery);
        $this->body = [];
        $this->parseJsonBody();
    }

    public static function fromSymfony(\Symfony\Component\HttpFoundation\Request $r, string $ip): self
    {
        $headers = [];
        foreach ($r->headers->all() as $name => $values) {
            $headers[strtolower((string) $name)] = implode(', ', $values);
        }
        $uri = $r->server->get('REQUEST_URI') ?? $r->getRequestUri();
        $pathPart = explode('?', (string) $uri, 2)[0];
        $rawQuery = (string) ($r->server->get('QUERY_STRING') ?? '');
        if ($rawQuery === '' && str_contains((string) $uri, '?')) {
            $rawQuery = explode('?', (string) $uri, 2)[1];
        }
        $files = [];
        foreach ($r->files->all() as $field => $file) {
            $files[$field] = $file;
        }
        $content = (string) $r->getContent();
        return new self(
            strtoupper($r->getMethod()),
            $pathPart === '' ? '/' : $pathPart,
            (string) $uri,
            $headers,
            $r->cookies->all(),
            $ip,
            $rawQuery,
            $content,
            $files,
            $r->request->all(),
        );
    }

    public function header(string $name): ?string
    {
        $v = $this->headers[strtolower($name)] ?? null;
        return $v === '' ? ($v) : $v;
    }

    public function param(string $name): ?string
    {
        return $this->params[$name] ?? null;
    }

    /** express.json(): only `application/json` (and `+json`) bodies are parsed; anything else leaves req.body = {}. */
    private function parseJsonBody(): void
    {
        $type = strtolower(trim(explode(';', $this->headers['content-type'] ?? '')[0]));
        $isJson = $type === 'application/json' || (str_starts_with($type, 'application/') && str_ends_with($type, '+json'));
        if (!$isJson) {
            return;
        }
        $length = isset($this->headers['content-length']) ? (int) $this->headers['content-length'] : strlen($this->rawBody);
        if ($length > self::BODY_LIMIT || strlen($this->rawBody) > self::BODY_LIMIT) {
            throw new BodyParseError('request entity too large');
        }
        if ($this->rawBody === '') {
            return; // body-parser leaves {} for an empty body
        }
        // strict mode: the first non-whitespace character must be { or [
        $first = ltrim($this->rawBody, " \t\n\r")[0] ?? '';
        if ($first !== '{' && $first !== '[') {
            throw new BodyParseError('Unexpected token');
        }
        try {
            $decoded = json_decode($this->rawBody, false, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new BodyParseError($e->getMessage());
        }
        $this->bodyIsObject = $decoded instanceof \stdClass;
        $this->body = self::toArrays($decoded);
    }

    /** Converts decoded JSON (stdClass) into assoc arrays, keeping the "was an object" bit for nested objects via ObjectMarker. */
    public static function toArrays(mixed $v): mixed
    {
        if ($v instanceof \stdClass) {
            $out = new JsonObject();
            foreach (get_object_vars($v) as $k => $x) {
                $out[$k] = self::toArrays($x);
            }
            return $out;
        }
        if (is_array($v)) {
            return array_map(self::toArrays(...), $v);
        }
        return $v;
    }

    /** Body as a plain assoc array (for handlers that read req.body without a schema). */
    public function bodyArray(): array
    {
        $b = $this->body;
        if ($b instanceof JsonObject) {
            return $b->toArray();
        }
        return is_array($b) ? $b : [];
    }
}
