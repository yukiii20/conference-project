<?php

declare(strict_types=1);

namespace App\Modules\Auth;

use App\Core\Js;
use App\Support\Phone;
use App\Validation\Payload;
use App\Validation\Schema;
use App\Validation\Z;

/** Port of modules/auth/validation.ts (same rules, same messages, same order). */
final class AuthValidation
{
    public const APPROVAL_ROLE_CODES = ['author', 'reviewer', 'session_chair', 'staff', 'manager'];
    public const AUDIENCE_ROLE = 'attendee';
    public const SIGNUP_ROLE_CODES = ['author', 'reviewer', 'session_chair', 'staff', 'manager', 'attendee'];
    public const LOGIN_ROLE_CODES = ['author', 'reviewer', 'session_chair', 'staff', 'manager', 'convenor', 'attendee'];

    public static function name(): Schema
    {
        return Z::string()->trim()
            ->min(2, 'Full name must be at least 2 characters.')
            ->max(100, 'Full name must be 100 characters or fewer.')
            ->regex("/^[A-Za-z .'-]+$/", "Use letters, spaces, '.', apostrophes, or hyphens only.");
    }

    public static function email(): Schema
    {
        return Z::string()->trim()
            ->min(1, 'Email is required.')
            ->email('Enter a valid email address.')
            ->transform(static fn (string $v) => \App\Core\JsString::lower($v));
    }

    public static function phone(): Schema
    {
        return Z::string()->trim()
            ->min(1, 'Phone number is required.')
            ->transform(static function (string $value, Payload $ctx) {
                $normalized = Phone::normalize($value);
                if ($normalized === null) {
                    $ctx->addIssue(['code' => 'custom', 'message' => 'Enter a Nepal mobile number, e.g. 98XXXXXXXX or +97798XXXXXXXX.']);
                    return Z::never();
                }
                return $normalized;
            });
    }

    public static function password(): Schema
    {
        $rules = [
            ['at least 8 characters', static fn (string $p) => \App\Core\JsString::length($p) >= 8],
            ['one uppercase letter', static fn (string $p) => preg_match('/[A-Z]/', $p) === 1],
            ['one lowercase letter', static fn (string $p) => preg_match('/[a-z]/', $p) === 1],
            ['one number', static fn (string $p) => preg_match('/[0-9]/', $p) === 1],
            ['one symbol', static fn (string $p) => preg_match('/[^A-Za-z0-9]/', $p) === 1],
        ];
        return Z::string()->superRefine(static function (string $value, Payload $ctx) use ($rules): void {
            foreach ($rules as [$label, $test]) {
                if (!$test($value)) {
                    $ctx->addIssue(['code' => 'custom', 'message' => "Password needs {$label}."]);
                }
            }
        });
    }

    public static function conferenceRef(): Schema
    {
        return Z::string(['error' => 'Choose a conference.'])->trim()
            ->min(1, 'Choose a conference.')
            ->max(80, 'Choose a conference.');
    }

    private static function categoryId(): Schema
    {
        return Z::string()->uuid('Choose a registration category.')->optional();
    }

    private static function requireCategoryForAudience(): callable
    {
        return static function (array $value, Payload $ctx): void {
            if (($value['requested_role'] ?? null) === self::AUDIENCE_ROLE && !Js::truthy($value['category_id'] ?? null)) {
                $ctx->addIssue(['code' => 'custom', 'path' => ['category_id'], 'message' => 'Choose a registration category.']);
            }
        };
    }

    public static function register(): Schema
    {
        return Z::object([
            'full_name' => self::name(),
            'email' => self::email(),
            'phone' => self::phone(),
            'password' => self::password(),
            'requested_role' => Z::enum(self::SIGNUP_ROLE_CODES),
            'conference_id' => Z::string()->uuid('Choose a conference.'),
            'category_id' => self::categoryId(),
        ])->superRefine(self::requireCategoryForAudience());
    }

    public static function login(): Schema
    {
        return Z::object([
            'email' => self::email(),
            'password' => Z::string()->min(1, 'Password is required.'),
            'role' => Z::enum(self::LOGIN_ROLE_CODES),
            'remember_me' => Z::boolean()->optional()->default(true),
            'conference' => self::conferenceRef(),
        ]);
    }

    public static function joinConference(): Schema
    {
        return Z::object([
            'email' => self::email(),
            'password' => Z::string()->min(1, 'Enter the password of your existing account.'),
            'requested_role' => Z::enum(self::SIGNUP_ROLE_CODES),
            'conference' => self::conferenceRef(),
            'category_id' => self::categoryId(),
        ])->superRefine(self::requireCategoryForAudience());
    }

    public static function requestRole(): Schema
    {
        return Z::object([
            'requested_role' => Z::enum(self::SIGNUP_ROLE_CODES),
            'conference' => self::conferenceRef(),
            'category_id' => self::categoryId(),
        ])->superRefine(self::requireCategoryForAudience());
    }

    public static function switchConference(): Schema
    {
        return Z::object(['conference_id' => Z::string()->uuid('Choose a conference.')]);
    }

    public static function adminLogin(): Schema
    {
        return Z::object([
            'email' => self::email(),
            'password' => Z::string()->min(1, 'Password is required.'),
        ]);
    }

    public static function changePassword(): Schema
    {
        return Z::object([
            'current_password' => Z::string()->min(1, 'Current password is required.'),
            'new_password' => self::password(),
        ]);
    }

    public static function forgotPassword(): Schema
    {
        return Z::object([
            'email' => self::email(),
            'conference' => self::conferenceRef()->optional(),
        ]);
    }

    public static function resetPassword(): Schema
    {
        return Z::object([
            'token' => Z::string()->min(1, 'Reset token is required.'),
            'password' => self::password(),
        ]);
    }

    public static function acceptInvitation(): Schema
    {
        return Z::object([
            'token' => Z::string()->min(1, 'Invitation token is required.'),
            'password' => self::password(),
            'conference' => self::conferenceRef()->optional(),
        ]);
    }

    /** A blank string means "clear this field" (-> NULL). */
    public static function optionalText(int $max, string $label): Schema
    {
        return Z::string()->trim()
            ->max($max, "{$label} must be {$max} characters or fewer.")
            ->nullable()
            ->optional()
            ->transform(static fn ($v) => ($v === '' || $v === null || Schema::isUndef($v)) ? null : $v);
    }

    private static function blankToNull(): callable
    {
        return static fn ($v) => ($v === '' || $v === null || Schema::isUndef($v)) ? null : $v;
    }

    public static function updateProfile(): Schema
    {
        return Z::object([
            'full_name' => self::name()->optional(),
            'phone' => self::phone()->optional(),
            'institution' => self::optionalText(300, 'Institution'),
            'department' => self::optionalText(300, 'Department'),
            'position' => self::optionalText(200, 'Position'),
            'country' => Z::string()->trim()->toUpperCase()->nullable()->optional()
                ->transform(self::blankToNull())
                ->refine(static fn ($v) => $v === null || preg_match('/^[A-Z]{2}$/', $v) === 1, 'Use a 2-letter country code, e.g. NP.'),
            'orcid' => Z::string()->trim()->nullable()->optional()
                ->transform(self::blankToNull())
                ->refine(static fn ($v) => $v === null || preg_match('/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/', $v) === 1, 'Use the format 0000-0000-0000-000X.'),
            'bio' => self::optionalText(1000, 'Bio'),
            'photo_path' => self::optionalText(500, 'Photo path'),
        ]);
    }
}
