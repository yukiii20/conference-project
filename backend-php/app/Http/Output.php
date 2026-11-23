<?php

declare(strict_types=1);

namespace App\Http;

use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The final response: status, the exact header lines to send, and the body. Headers are
 * emitted with header() as-is, because Symfony's header bag rewrites Cache-Control ("no-store"
 * becomes "no-store, private") and re-serialises Set-Cookie, which Node never did.
 */
final class Output
{
    /** @param list<array{0: string, 1: string}> $headers */
    public function __construct(
        public readonly int $status,
        public readonly array $headers,
        public readonly Response $response,
        public readonly bool $withBody,
    ) {
    }

    /** @return list<string> all values of one header (case-insensitive) */
    public function header(string $name): array
    {
        $out = [];
        foreach ($this->headers as [$k, $v]) {
            if (strcasecmp($k, $name) === 0) {
                $out[] = $v;
            }
        }
        return $out;
    }

    public function body(): string
    {
        if (!$this->withBody) {
            return '';
        }
        if ($this->response instanceof StreamedResponse) {
            ob_start();
            $this->response->sendContent();
            return (string) ob_get_clean();
        }
        return (string) $this->response->getContent();
    }

    public function send(): void
    {
        if (!headers_sent()) {
            header_remove();
            http_response_code($this->status);
            foreach ($this->headers as [$name, $value]) {
                header($name . ': ' . $value, false);
            }
        }
        if (!$this->withBody) {
            return;
        }
        if ($this->response instanceof StreamedResponse) {
            $this->response->sendContent();
            return;
        }
        echo (string) $this->response->getContent();
    }
}
