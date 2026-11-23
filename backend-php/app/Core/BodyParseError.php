<?php

declare(strict_types=1);

namespace App\Core;

/** A request body that could not be parsed (malformed JSON, over 100 kb). Node answered these with a 500. */
class BodyParseError extends \RuntimeException
{
}
