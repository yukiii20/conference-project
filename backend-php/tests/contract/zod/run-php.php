<?php

// Runs every case through the PHP port. "auth.registerSchema" -> App\Modules\Auth\AuthValidation::register().
declare(strict_types=1);

require __DIR__ . '/../../../vendor/autoload.php';

[$casesFile, $outFile] = array_slice($argv, 1);
$cases = json_decode((string) file_get_contents($casesFile), false);
$results = [];
foreach ($cases as $c) {
    [$mod, $name] = explode('.', $c->schema);
    $class = 'App\\Modules\\' . ucfirst($mod) . '\\' . ucfirst($mod) . 'Validation';
    $method = (string) preg_replace('/Schema$/', '', $name);
    $schema = $class::$method();
    $input = \App\Http\Req::toArrays($c->input);
    $r = $schema->safeParse($input);
    $results[] = $r['success']
        ? ['id' => $c->id, 'success' => true, 'data' => $r['data'] === [] ? \App\Core\Json::obj() : $r['data']]
        : ['id' => $c->id, 'success' => false, 'issues' => array_map(static fn ($i) => [$i['path'], $i['message']], $r['issues'])];
}
file_put_contents($outFile, \App\Core\Json::encode($results));
