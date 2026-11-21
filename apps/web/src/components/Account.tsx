'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiRoot } from './realtime/access-session';
import { ActionForm, field, formText, secondary } from './farmline/forms';

async function accountRequest(path: string, body: unknown) {
  const response = await fetch(apiRoot + '/auth/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.ok) return;
  const error = (await response.json().catch(() => ({}))) as { message?: string | string[] };
  throw new Error(
    Array.isArray(error.message)
      ? error.message.join(', ')
      : (error.message ?? 'Unable to update your account. Try again.'),
  );
}

export function Account({ returnTo }: { returnTo: string }) {
  const [verifying, setVerifying] = useState(false);
  const router = useRouter();
  return (
    <main className="workspace-sign-in mx-auto w-[calc(100%-1.5rem)] max-w-md space-y-4 p-6 sm:p-8">
      <h1 className="font-serif text-3xl">
        {verifying ? 'Verify your email' : 'Create a CropCircle account'}
      </h1>
      {verifying ? (
        <>
          <p className="text-sm text-[#435949]">
            Enter the verification code from your CropCircle email and choose your sign-in details.
          </p>
          <ActionForm
            key="verify"
            label="Verify email"
            submit={async (data) => {
              await accountRequest('email-verification', {
                token: formText(data, 'token'),
                displayName: formText(data, 'displayName'),
                password: data.get('password'),
              });
              router.push(returnTo);
            }}
          >
            <label className="block text-sm font-semibold">
              Verification code
              <input
                name="token"
                className={field}
                autoComplete="one-time-code"
                maxLength={43}
                required
              />
            </label>
            <label className="block text-sm font-semibold">
              Display name
              <input
                name="displayName"
                className={field}
                autoComplete="name"
                maxLength={100}
                required
              />
            </label>
            <label className="block text-sm font-semibold">
              Password
              <input
                name="password"
                className={field}
                type="password"
                autoComplete="new-password"
                minLength={15}
                maxLength={128}
                required
              />
            </label>
          </ActionForm>
          <button className={secondary} onClick={() => setVerifying(false)}>
            Back to email
          </button>
        </>
      ) : (
        <>
          <ActionForm
            key="register"
            label="Send verification email"
            submit={async (data) => {
              await accountRequest('registrations', { email: formText(data, 'email') });
              setVerifying(true);
            }}
          >
            <label className="block text-sm font-semibold">
              Email
              <input name="email" className={field} type="email" autoComplete="email" required />
            </label>
          </ActionForm>
          <button className="text-sm font-semibold underline" onClick={() => setVerifying(true)}>
            I already have a verification code
          </button>
        </>
      )}
      <p>
        <Link href={returnTo} className="text-sm font-semibold underline">
          Return to sign in
        </Link>
      </p>
    </main>
  );
}
