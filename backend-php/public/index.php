<?php

declare(strict_types=1);

/*
 * The HTTP entry point. Requests go straight to App\Http\Kernel, a port of the Express pipeline
 * (server/src/app.ts), so responses match the Node backend byte for byte. Laravel's own HTTP
 * kernel is not booted here; Laravel is used for the console (artisan: workers, scheduler).
 */

require __DIR__ . '/../vendor/autoload.php';

// Real environment variables win over .env (same as dotenv in Node).
Dotenv\Dotenv::createImmutable(dirname(__DIR__))->safeLoad();

// Refuses to serve with an invalid configuration, like env.ts did at start-up.
App\Core\Env::all();

$request = Symfony\Component\HttpFoundation\Request::createFromGlobals();
$kernel = new App\Http\Kernel(new App\Http\Routes());
// PHP would otherwise add "Content-Type: text/html" to responses that have none (204, 304).
ini_set('default_mimetype', '');
$kernel->handle($request)->send();

if (function_exists('fastcgi_finish_request')) {
    fastcgi_finish_request();
}
App\Http\AfterResponse::run();
