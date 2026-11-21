# Authentication and organization access

All routes below are under `/api/v1`. JSON request bodies reject unknown fields. Send the access token in `Authorization: Bearer <accessToken>` for protected routes. Use `credentials: 'include'` for browser requests to login, refresh, and logout routes.

| Method and route                       | Body                               | Success                                                          |
| -------------------------------------- | ---------------------------------- | ---------------------------------------------------------------- |
| POST `/auth/registrations`             | `email`                            | 202. A new or pending email receives a verification code.        |
| POST `/auth/email-verification/resend` | `email`                            | 202. A pending email receives another code.                      |
| POST `/auth/email-verification`        | `token`, `displayName`, `password` | 204. Verifies the email and sets the initial password.           |
| POST `/auth/login`                     | `email`, `password`                | 200. Returns a bearer JWT and sets a refresh cookie.             |
| POST `/auth/refresh`                   | Refresh cookie                     | 200. Returns a new JWT and rotates the refresh cookie.           |
| GET `/auth/me`                         | Bearer JWT                         | 200. Returns the caller's identity and platform roles.           |
| POST `/auth/logout`                    | Refresh cookie                     | 204. Revokes the session and clears the cookie.                  |
| POST `/auth/logout-all`                | Bearer JWT                         | 204. Revokes every session for the caller and clears the cookie. |
| POST `/auth/password-recovery`         | `email`                            | 202. An active account receives a reset code.                    |
| POST `/auth/password-reset`            | `token`, `password`                | 204. Changes the password and revokes all existing sessions.     |

Registration starts with email. The user chooses their name and password when they confirm the code, so an earlier signup attempt cannot set a password for someone else's mailbox. Passwords must be 15 to 128 characters. Verification codes expire after 24 hours. Recovery codes expire after 30 minutes and can be used once. Recovery and resend return the same status for unknown and ineligible addresses. Email delivery runs asynchronously. If delivery fails, users can request another code.

Access JWTs expire after 10 minutes. Refresh cookies are HTTP-only, use `SameSite=Strict`, and expire 30 days after login. Send cookie requests from the configured `WEB_ORIGIN` and serialize refresh and logout requests in the client. Rotating a cookie invalidates its previous value. Keep the access token in memory and renew it through the cookie. PostgreSQL checks the session and account on each authenticated request, so revocation and suspension take effect without waiting for the JWT to expire.

## Organizations

An organization has its own UUID and an organization type. It does not have a login. Every member signs in as an individual user, and a user can have different membership roles in several organizations. Registration grants the baseline `USER` role. Organization routes require that platform role and check the relevant membership separately. Administrative roles are reserved for trusted operations. Membership and organization state are checked against PostgreSQL.

| Method and route                                                          | Who can call it                                                                      |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| POST `/organizations` with `name` and `type`                              | A verified user. The caller becomes the owner.                                       |
| GET `/organizations`                                                      | A verified user. Returns their active memberships only.                              |
| GET `/organizations/:organizationId`                                      | A member of that active organization.                                                |
| GET `/organizations/:organizationId/members`                              | The owner or a manager.                                                              |
| POST `/organizations/:organizationId/invitations` with `email` and `role` | Owners can invite managers or members. Managers can invite members.                  |
| POST `/organizations/invitations/accept` with `token`                     | The verified user whose email matches the invitation. Codes expire after seven days. |
| DELETE `/organizations/:organizationId/members/:membershipId`             | Owners can remove managers or members. Managers can remove members.                  |

The allowed types are `farm`, `food_bank`, `community_organization`, `farmers_market`, and `produce_buyer`. Organization and membership responses select only their documented fields; site names, addresses, and coordinates stay private. Member rosters expose member IDs, roles, and display names. They omit email addresses.

## Running locally

The existing Compose setup now includes [Mailpit](https://mailpit.axllent.org/docs/api-v1/) at `http://localhost:8025`. Open it to retrieve verification, reset, and invitation codes. Compose applies the Prisma migration before starting the API. For an API running on the host, run `docker compose up -d db redis mail`, apply migrations with the host `DATABASE_URL`, then start the API with `pnpm --filter @cropcircle/api dev`.

Run the integration tests against an isolated development stack with:

```sh
docker compose exec -T -e AUTH_TEST_MAIL_URL=http://mail:8025 api pnpm test:auth
```

For a host deployment, configure `NODE_ENV=production`, an HTTPS `WEB_ORIGIN`, `AUTH_JWT_SECRET`, and a TLS-capable `AUTH_SMTP_HOST`, `AUTH_SMTP_PORT`, and `AUTH_MAIL_FROM`. Set `AUTH_SMTP_USER` and `AUTH_SMTP_PASSWORD` if the relay requires credentials. A key can be generated with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Use the same key across replicas. In production, refresh cookies also use `Secure`. Keep the API and browser app on the same site so the strict cookie can be sent. Authentication rate limits use Redis and the connection IP by default. If forwarding traffic through a proxy, configure abuse limits at that trusted ingress as well.

The auth module uses [NestJS JWT support](https://github.com/nestjs/jwt), Node's scrypt with an [OWASP-recommended work factor](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), and [Nodemailer SMTP](https://nodemailer.com/smtp).
