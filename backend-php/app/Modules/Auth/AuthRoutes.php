<?php

declare(strict_types=1);

namespace App\Modules\Auth;

use App\Auth\Session;
use App\Core\ForbiddenError;
use App\Db\Connection;
use App\Db\Db;
use App\Http\Middleware\Guards;
use App\Http\Middleware\RateLimit;
use App\Http\Middleware\Validate;
use App\Http\Req;
use App\Http\Res;
use App\Http\Router;
use App\Support\Audit;
use Symfony\Component\HttpFoundation\Response;

/** Port of modules/auth/routes.ts, mounted at /api/auth. */
final class AuthRoutes
{
    public static function sessionConferenceDto(?array $c): ?array
    {
        if ($c === null) {
            return null;
        }
        return ['id' => $c['id'], 'slug' => $c['slug'], 'name' => $c['name'], 'logo_path' => $c['logo_path'], 'primary_color' => $c['primary_color']];
    }

    private static function createSession(Req $req, string $userId, bool $rememberMe, bool $isAdmin, ?string $conferenceId): void
    {
        Db::tx($userId, static fn (Connection $conn) => Session::create(
            $conn, $userId, $rememberMe, $isAdmin, $conferenceId, $req->header('user-agent'), $req->ip !== '' ? $req->ip : null,
        ));
    }

    private static function signInAfterAudienceSignup(Req $req, string $userId, array $conference, mixed $registration, string $message): Response
    {
        self::createSession($req, $userId, true, false, $conference['id']);
        $roles = AuthService::getMyRoles($userId, $conference['id']);
        $profile = AuthService::getUserProfile($userId);
        return Res::json([
            'message' => $message,
            'signed_in' => true,
            'user' => $profile,
            'roles' => $roles,
            'conference' => self::sessionConferenceDto($conference),
            'registration' => $registration,
        ], 201);
    }

    /** Must run inside the session scope (after requireAuth). */
    private static function meResponse(Req $req): array
    {
        $user = $req->user;
        $bound = $user->conferenceId;
        return [
            'user' => AuthService::getUserProfile($user->id),
            'roles' => AuthService::getMyRoles($user->id, $bound),
            'isAdmin' => AuthService::isPlatformAdmin($user->id),
            'isSuperAdmin' => AuthService::isSuperAdmin($user->id),
            'conference' => self::sessionConferenceDto($bound ? AuthService::findConference($bound, false) : null),
        ];
    }

    public static function router(): Router
    {
        $r = new Router();
        $ctx = static fn (Req $req) => Audit::context($req);

        $r->post('/register', RateLimit::auth(), Validate::body(AuthValidation::register()), static function (Req $req) use ($ctx) {
            $body = $req->body;
            $result = AuthService::registerUser($body, $ctx($req));
            if ($result['registration'] !== null) {
                $conference = AuthService::findConference($body['conference_id'], true);
                if ($conference !== null) {
                    return self::signInAfterAudienceSignup($req, $result['userId'], $conference, $result['registration'], 'Account created and registered. Your ticket is ready.');
                }
            }
            return Res::json([
                'message' => "Account created. The conference's convenor must approve it before you can sign in.",
                'signed_in' => false,
            ], 201);
        });

        $r->post('/join-conference', RateLimit::auth(), Validate::body(AuthValidation::joinConference()), static function (Req $req) use ($ctx) {
            $result = AuthService::joinConferenceWithExistingAccount($req->body, $ctx($req));
            $conference = $result['conference'];
            if ($result['registration'] !== null) {
                return self::signInAfterAudienceSignup($req, $result['userId'], $conference, $result['registration'], "You are registered for {$conference['name']}. Your ticket is ready.");
            }
            return Res::json([
                'signed_in' => false,
                'message' => "Request sent. You can sign in at {$conference['name']} once the convenor approves it.",
                'conference' => self::sessionConferenceDto($conference),
            ], 201);
        });

        $r->post('/login', RateLimit::auth(), Validate::body(AuthValidation::login()), static function (Req $req) use ($ctx) {
            $b = $req->body;
            $result = AuthService::verifyLogin($b['email'], $b['password'], $b['role'], $b['conference'], $ctx($req));
            $userId = $result['userId'];
            $conference = $result['conference'];
            self::createSession($req, $userId, (bool) $b['remember_me'], false, $conference['id']);
            return Res::json([
                'user' => AuthService::getUserProfile($userId),
                'roles' => AuthService::getMyRoles($userId, $conference['id']),
                'conference' => self::sessionConferenceDto($conference),
            ]);
        });

        $r->post('/admin-login', RateLimit::auth(), Validate::body(AuthValidation::adminLogin()), static function (Req $req) {
            $userId = AuthService::verifyAdminLogin($req->body['email'], $req->body['password'])['userId'];
            self::createSession($req, $userId, false, true, null);
            return Res::json([
                'user' => AuthService::getUserProfile($userId),
                'roles' => AuthService::getMyRoles($userId, null),
                'conference' => null,
            ]);
        });

        $r->post('/logout', static function (Req $req) {
            $conferenceSlug = null;
            if (Session::token($req) !== null) {
                $user = Session::resolve($req);
                if ($user !== null) {
                    if ($user->conferenceId) {
                        $conferenceSlug = AuthService::findConference($user->conferenceId, false)['slug'] ?? null;
                    }
                    Session::revoke($user->sessionId);
                }
            }
            Session::clearCookie();
            return Res::json(['message' => 'Signed out.', 'conference_slug' => $conferenceSlug]);
        });

        $r->get('/me', Guards::auth(), static fn (Req $req) => Res::json(self::meResponse($req)));

        $r->get('/session', static function (Req $req) {
            $session = Session::resolve($req);
            if ($session === null) {
                return Res::json(['user' => null, 'roles' => [], 'isAdmin' => false, 'isSuperAdmin' => false, 'conference' => null]);
            }
            Guards::authenticate($req);
            return Res::json(self::meResponse($req));
        });

        $r->get('/my-conferences', Guards::auth(), static function (Req $req) {
            $current = $req->user->conferenceId;
            $list = array_map(
                static fn (array $c) => $c + ['is_current' => $c['conference_id'] === $current],
                AuthService::listMyConferences($req->user->id),
            );
            return Res::json(['current_conference_id' => $current, 'conferences' => $list]);
        });

        $r->post('/switch-conference', Guards::auth(), Validate::body(AuthValidation::switchConference()), static function (Req $req) {
            $current = $req->user;
            if ($current->isAdminSession) {
                throw new ForbiddenError('Administrator sessions open conferences with "View as admin".');
            }
            $switch = AuthService::assertCanSwitchTo($current->id, $req->body['conference_id']);
            $conference = $switch['conference'];
            $rememberMe = (bool) (Db::pool()->first('SELECT remember_me FROM auth_sessions WHERE id = ? LIMIT 1', [$current->sessionId])['remember_me'] ?? false);

            Db::tx($current->id, static function (Connection $conn) use ($req, $current, $conference, $switch, $rememberMe): void {
                $conn->run('UPDATE auth_sessions SET revoked_at = NOW(3) WHERE id = ? AND revoked_at IS NULL', [$current->sessionId]);
                Session::create($conn, $current->id, $rememberMe, false, $conference['id'], $req->header('user-agent'), $req->ip !== '' ? $req->ip : null);
                Audit::insert($conn, [
                    'actorUserId' => $current->id,
                    'conferenceId' => $conference['id'],
                    'action' => 'auth.switch_conference',
                    'entityType' => 'auth_sessions',
                    'entityId' => $current->sessionId,
                    'oldValues' => ['conference_id' => $current->conferenceId],
                    'newValues' => ['conference_id' => $conference['id'], 'roles' => $switch['roles']],
                    'ipAddress' => $req->ip !== '' ? $req->ip : null,
                    'userAgent' => $req->header('user-agent'),
                ]);
            });
            return Res::json([
                'user' => AuthService::getUserProfile($current->id),
                'roles' => AuthService::getMyRoles($current->id, $conference['id']),
                'conference' => self::sessionConferenceDto($conference),
            ]);
        });

        $r->post('/request-role', Guards::auth(), RateLimit::auth(), Validate::body(AuthValidation::requestRole()), static function (Req $req) use ($ctx) {
            $b = $req->body;
            $result = AuthService::requestRoleAsSignedInUser($req->user->id, $b['conference'], $b['requested_role'], $ctx($req), $b['category_id'] ?? null);
            $conference = $result['conference'];
            if ($result['registration'] !== null) {
                return Res::json([
                    'message' => "You are registered for {$conference['name']}. Switch to it to see your ticket.",
                    'conference' => self::sessionConferenceDto($conference),
                    'registration' => $result['registration'],
                ], 201);
            }
            return Res::json([
                'message' => "Request sent. You can sign in at {$conference['name']} once the convenor approves it.",
                'conference' => self::sessionConferenceDto($conference),
            ], 201);
        });

        $r->patch('/profile', Guards::auth(), Validate::body(AuthValidation::updateProfile()), static function (Req $req) {
            AuthService::updateProfile($req->user->id, $req->body);
            return Res::json(['user' => AuthService::getUserProfile($req->user->id)]);
        });

        $r->post('/change-password', Guards::auth(), Validate::body(AuthValidation::changePassword()), static function (Req $req) use ($ctx) {
            AuthService::changePassword($req->user->id, $req->body['current_password'], $req->body['new_password'], $req->user->sessionId, $ctx($req));
            return Res::json(['message' => 'Password updated.']);
        });

        $r->post('/forgot-password', RateLimit::forgotPasswordIp(), RateLimit::forgotPasswordEmail(), Validate::body(AuthValidation::forgotPassword()), static function (Req $req) {
            AuthService::requestPasswordReset($req->body['email'], $req->body['conference'] ?? null);
            return Res::json(['message' => "If an account exists for this email, we've sent a reset link."]);
        });

        $r->post('/reset-password', RateLimit::auth(), Validate::body(AuthValidation::resetPassword()), static function (Req $req) use ($ctx) {
            AuthService::resetPassword($req->body['token'], $req->body['password'], $ctx($req));
            return Res::json(['message' => 'Password updated. You can now sign in.']);
        });

        $r->post('/accept-invitation', RateLimit::auth(), Validate::body(AuthValidation::acceptInvitation()), static function (Req $req) use ($ctx) {
            $userId = AuthService::acceptInvitation($req->body['token'], $req->body['password'], $ctx($req))['userId'];
            $conference = AuthService::invitationSessionConference($userId, $req->body['conference'] ?? null);
            if ($conference === null) {
                return Res::json(['user' => null, 'roles' => [], 'conference' => null, 'signed_in' => false]);
            }
            self::createSession($req, $userId, true, false, $conference['id']);
            return Res::json([
                'user' => AuthService::getUserProfile($userId),
                'roles' => AuthService::getMyRoles($userId, $conference['id']),
                'conference' => self::sessionConferenceDto($conference),
                'signed_in' => true,
            ]);
        });

        return $r;
    }
}
