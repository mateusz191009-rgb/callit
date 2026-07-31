'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Globe } from 'lucide-react';
import { toast } from 'sonner';
import Modal from '@/components/ui/modal';
import Tabs from '@/components/ui/tabs';
import Input from '@/components/ui/input';
import Button from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { play } from '@/lib/sound';
import { useCallitStore, type AuthResult } from '@/lib/store';
import { checkReferralCodeCloud } from '@/lib/cloud';
import { clearStoredRefCode, storedRefCode } from '@/lib/referral';
import Turnstile, { turnstileRequired } from '@/components/auth/Turnstile';

type AuthTab = 'signin' | 'signup';

const TAB_ITEMS: { value: AuthTab; label: string }[] = [
  { value: 'signin', label: 'Sign in' },
  { value: 'signup', label: 'Sign up' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const USERNAME_MIN = 3;
const USERNAME_MAX = 20;
/** Long enough that a fast typist does not fire a request per keystroke,
 *  short enough that the answer is there before they reach the password. */
const USERNAME_CHECK_DEBOUNCE_MS = 400;

const USERNAME_TAKEN = 'This username is already taken — pick another one.';
const EMAIL_TAKEN = 'An account with this email already exists.';

interface FieldErrors {
  email?: string;
  username?: string;
  password?: string;
  age?: string;
  refCode?: string;
}

/** v25.48 — live availability of the typed username. `idle` also covers
 *  "could not check" (offline / migration not applied): saying nothing is
 *  the only honest state, since neither "available" nor "taken" is known. */
type UsernameStatus = 'idle' | 'checking' | 'free' | 'taken';

/** An auth error plus which input it belongs under, so the modal can mark
 *  the offending field instead of printing everything at the bottom. */
interface MappedError {
  field?: 'email' | 'username';
  message: string;
}

/**
 * Normalizes auth errors from the store (local demo mode) and Supabase
 * into short, consistent UI copy. Unknown errors pass through verbatim.
 */
function mapAuthError(result: AuthResult): MappedError {
  const error = result.error;
  if (!error) return { message: 'Something went wrong. Please try again.' };
  // The store tags the two cases it knows for certain (v25.48) — trust that
  // over guessing from the wording.
  if (result.field) return { field: result.field, message: error };

  const e = error.toLowerCase();
  // "Username already taken" ALSO contains "already", so the specific word
  // has to be tested first — otherwise a name collision was reported to the
  // user as "Email already registered", under the wrong field, and they
  // changed the one thing that was fine.
  if (e.includes('username')) return { field: 'username', message: error };
  if (e.includes('already')) return { field: 'email', message: EMAIL_TAKEN };
  // A rejected password is a credentials error even though the sentence
  // says "email" ("Invalid email or password."); test it before the email
  // branch or it comes back as "Please enter a valid email address."
  if (e.includes('password') || e.includes('credential')) {
    return { message: 'Invalid email or password.' };
  }
  // Supabase email validation ("Email address ... is invalid") must not be
  // collapsed into a credentials error — tell the user what to fix.
  if (e.includes('invalid') && e.includes('email')) {
    return { field: 'email', message: 'Please enter a valid email address.' };
  }
  if (e.includes('invalid')) return { message: 'Invalid credentials' };
  if (e.includes('confirm')) {
    return { message: 'Please confirm your email first — check your inbox for the link.' };
  }
  if (e.includes('banned')) return { message: 'Account banned' };
  return { message: error };
}

export interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  defaultTab?: AuthTab;
}

/**
 * Sign in / Sign up modal. Validates locally (email shape, username length,
 * password length) before calling the dual-mode store actions.
 */
export default function AuthModal({ open, onClose, defaultTab = 'signin' }: AuthModalProps) {
  const signIn = useCallitStore((s) => s.signIn);
  const signUp = useCallitStore((s) => s.signUp);
  const checkUsernameAvailable = useCallitStore((s) => s.checkUsernameAvailable);

  const [tab, setTab] = useState<AuthTab>(defaultTab);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // v10 — optional referral code, prefilled from a captured `?ref=` link.
  const [refCode, setRefCode] = useState('');
  // Age + terms gate (sign-up only). Never pre-checked: the confirmation is
  // worthless if the default answers for the user.
  const [ageOk, setAgeOk] = useState(false);
  // v8 — Turnstile token (null = none yet / expired / captcha disabled).
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [storeError, setStoreError] = useState<string | null>(null);
  // v25.48 — live "is this name free?" answer for the username field.
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  // v25.48 — the email belongs to an existing account. Drives the "Sign in
  // instead" shortcut, which is the actual thing the user needs next.
  const [emailTaken, setEmailTaken] = useState(false);
  // Country name when the server refused sign-up on geo grounds (451 from
  // /api/auth/signup-check). Renders a dedicated notice instead of the
  // generic error line, and disables further sign-up attempts.
  const [geoBlock, setGeoBlock] = useState<string | null>(null);

  // Fresh form every time the modal opens, on the requested tab.
  useEffect(() => {
    if (!open) return;
    setTab(defaultTab);
    setEmail('');
    setUsername('');
    setPassword('');
    setRefCode(storedRefCode());
    setAgeOk(false);
    setCaptchaToken(null);
    setFieldErrors({});
    setStoreError(null);
    setUsernameStatus('idle');
    setEmailTaken(false);
    setGeoBlock(null);
    setLoading(false);
  }, [open, defaultTab]);

  const switchTab = (next: AuthTab) => {
    setTab(next);
    setAgeOk(false);
    setFieldErrors({});
    setStoreError(null);
    setUsernameStatus('idle');
    // Deliberately NOT clearing `email`: "Sign in instead" is only useful if
    // the address the user just typed is still in the box.
    setEmailTaken(false);
    // Only sign-UP is geo-restricted — switching to sign-in gets a clean
    // slate so existing users from restricted countries can still log in.
    setGeoBlock(null);
  };

  const trimmedUsername = username.trim();
  const usernameLengthOk =
    trimmedUsername.length >= USERNAME_MIN && trimmedUsername.length <= USERNAME_MAX;

  // v25.48 — ask while they type, not after the account exists. Debounced,
  // and every in-flight answer is discarded when the input moves on, so a
  // slow response for an old value can never label the current one.
  useEffect(() => {
    if (tab !== 'signup' || !usernameLengthOk) {
      setUsernameStatus('idle');
      return;
    }
    let cancelled = false;
    setUsernameStatus('checking');
    const timer = setTimeout(() => {
      void checkUsernameAvailable(trimmedUsername).then((free) => {
        if (cancelled) return;
        // null = the check itself failed. Claiming either answer would be a
        // guess, so the field goes quiet and submit decides.
        setUsernameStatus(free === null ? 'idle' : free ? 'free' : 'taken');
      });
    }, USERNAME_CHECK_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tab, trimmedUsername, usernameLengthOk, checkUsernameAvailable]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading) return;

    const errors: FieldErrors = {};
    if (!EMAIL_RE.test(email.trim())) {
      errors.email = 'Enter a valid email address.';
    }
    if (tab === 'signup') {
      const un = username.trim();
      if (un.length < USERNAME_MIN || un.length > USERNAME_MAX) {
        errors.username = `Username must be ${USERNAME_MIN}-${USERNAME_MAX} characters.`;
      } else if (usernameStatus === 'taken') {
        // Already answered while they typed — reject here rather than
        // spending a sign-up-gate rate-limit slot to learn it again.
        errors.username = USERNAME_TAKEN;
      }
      // The submit button is disabled until this is ticked; the check stays
      // as the actual gate, since a disabled button is only a UI hint.
      if (!ageOk) {
        errors.age = 'Confirm you are 18 or older and accept the Terms.';
      }
    }
    if (password.length < 6) {
      errors.password = 'Password must be at least 6 characters.';
    }
    setFieldErrors(errors);
    setStoreError(null);
    setEmailTaken(false);
    if (Object.keys(errors).length > 0) return;

    setLoading(true);

    // v25.48 — the authoritative username check, in case the debounced one
    // never ran (fast submit, typed-and-pasted) or the name was taken in
    // between. Same rule as the referral code below: only a definitive
    // `false` blocks — an unreachable check must not stop a sign-up.
    if (tab === 'signup') {
      const free = await checkUsernameAvailable(username.trim());
      if (free === false) {
        setLoading(false);
        setUsernameStatus('taken');
        setFieldErrors((f) => ({ ...f, username: USERNAME_TAKEN }));
        return;
      }
    }

    // v10 — referral code (optional): a definitive "does not exist" from
    // the server blocks submission so a typo never silently loses the
    // attribution; an unreachable check (null) must NOT block sign-up.
    if (tab === 'signup' && refCode.trim()) {
      const valid = await checkReferralCodeCloud(refCode.trim());
      if (valid === false) {
        setLoading(false);
        setFieldErrors((f) => ({
          ...f,
          refCode: 'This referral code does not exist — fix it or leave the field empty.',
        }));
        return;
      }
    }

    // v8 — sign-up gate: rate limit + (when configured) captcha, checked
    // server-side BEFORE the account exists. Degrades to a plain OK when
    // no Turnstile keys are set.
    if (tab === 'signup') {
      try {
        const gate = await fetch('/api/auth/signup-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), captchaToken: captchaToken ?? '' }),
        });
        const gateBody = (await gate.json()) as {
          ok?: boolean;
          error?: string;
          code?: string;
          country?: string;
        };
        if (!gateBody.ok) {
          setLoading(false);
          if (gateBody.code === 'geo_blocked') {
            setGeoBlock(gateBody.country ?? 'your country');
          } else if (gateBody.code === 'email_taken') {
            // v25.48 — the case Supabase deliberately hides from the client
            // (it answers a duplicate sign-up with a fake success). Mark the
            // field and offer the door they actually want.
            setFieldErrors((f) => ({ ...f, email: gateBody.error ?? EMAIL_TAKEN }));
            setEmailTaken(true);
          } else {
            setStoreError(gateBody.error ?? 'Sign-up is temporarily unavailable.');
          }
          return;
        }
      } catch {
        // The gate being unreachable must not brick sign-up entirely —
        // rate limiting is a hardening layer, not the auth itself.
      }
    }

    const result =
      tab === 'signin'
        ? await signIn(email, password)
        : await signUp(email, username, password, refCode.trim() || undefined);
    setLoading(false);

    if (result.ok) {
      if (tab === 'signup') clearStoredRefCode();
      if (result.info) {
        // Two cases: Supabase email confirmation is enabled (account
        // created, not signed in yet), or v25.48's lost-the-race notice
        // (signed in, but under a suffixed username). Both are "it worked,
        // with something you need to read" — hence info, not success.
        toast.info(result.info);
      } else {
        play('success');
        toast.success(tab === 'signin' ? 'Welcome back' : 'Account created');
      }
      onClose();
    } else {
      const mapped = mapAuthError(result);
      if (mapped.field === 'email') {
        setFieldErrors((f) => ({ ...f, email: mapped.message }));
        // Only sign-UP can hit "this address already has an account"; on
        // sign-in the same field error means a malformed address.
        if (tab === 'signup') setEmailTaken(true);
      } else if (mapped.field === 'username') {
        setFieldErrors((f) => ({ ...f, username: mapped.message }));
        setUsernameStatus('taken');
      } else {
        setStoreError(mapped.message);
      }
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tab === 'signin' ? 'Welcome back' : 'Create your account'}
    >
      <Tabs items={TAB_ITEMS} value={tab} onChange={switchTab} className="-mt-1 mb-5" />

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div>
          <label
            htmlFor="auth-email"
            className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-tx-mut"
          >
            Email
          </label>
          <Input
            id="auth-email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }));
              // A different address is a different question — drop the
              // verdict on the old one.
              if (emailTaken) setEmailTaken(false);
            }}
            placeholder="you@example.com"
            autoComplete="email"
            error={Boolean(fieldErrors.email)}
          />
          {fieldErrors.email && (
            <p className="mt-1.5 text-xs font-bold text-danger">{fieldErrors.email}</p>
          )}
          {emailTaken && tab === 'signup' && (
            <button
              type="button"
              onClick={() => switchTab('signin')}
              className="mt-1.5 text-xs font-bold text-green underline-offset-2 hover:underline"
            >
              Sign in instead
            </button>
          )}
        </div>

        {tab === 'signup' && (
          <div>
            <label
              htmlFor="auth-username"
              className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-tx-mut"
            >
              Username
            </label>
            <Input
              id="auth-username"
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (fieldErrors.username) {
                  setFieldErrors((f) => ({ ...f, username: undefined }));
                }
              }}
              placeholder="callmaker"
              autoComplete="username"
              maxLength={USERNAME_MAX}
              error={Boolean(fieldErrors.username) || usernameStatus === 'taken'}
            />
            {/* v25.48 — one slot, two sources: a submit-time error wins over
                the live status, and `aria-live` means a screen reader hears
                the verdict without having to leave and re-enter the field. */}
            <p
              aria-live="polite"
              className={cn(
                // `empty:mt-0` — the node stays mounted so aria-live has
                // something to announce into, but takes no space until it
                // actually says something.
                'mt-1.5 text-xs font-bold empty:mt-0',
                usernameStatus === 'free' && !fieldErrors.username
                  ? 'text-green'
                  : usernameStatus === 'checking' && !fieldErrors.username
                    ? 'font-semibold text-tx-mut'
                    : 'text-danger'
              )}
            >
              {fieldErrors.username ??
                (usernameStatus === 'taken'
                  ? USERNAME_TAKEN
                  : usernameStatus === 'free'
                    ? `"${trimmedUsername}" is available.`
                    : usernameStatus === 'checking'
                      ? 'Checking availability…'
                      : '')}
            </p>
          </div>
        )}

        <div>
          <label
            htmlFor="auth-password"
            className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-tx-mut"
          >
            Password
          </label>
          <Input
            id="auth-password"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (fieldErrors.password) {
                setFieldErrors((f) => ({ ...f, password: undefined }));
              }
            }}
            placeholder={tab === 'signup' ? 'At least 6 characters' : 'Your password'}
            autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
            error={Boolean(fieldErrors.password)}
          />
          {fieldErrors.password && (
            <p className="mt-1.5 text-xs font-bold text-danger">{fieldErrors.password}</p>
          )}
        </div>

        {tab === 'signup' && (
          <div>
            <label
              htmlFor="auth-ref"
              className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-tx-mut"
            >
              Referral code <span className="font-semibold normal-case">(optional)</span>
            </label>
            <Input
              id="auth-ref"
              type="text"
              value={refCode}
              onChange={(e) => {
                setRefCode(e.target.value);
                if (fieldErrors.refCode) {
                  setFieldErrors((f) => ({ ...f, refCode: undefined }));
                }
              }}
              placeholder="Friend's code"
              autoComplete="off"
              maxLength={20}
              error={Boolean(fieldErrors.refCode)}
            />
            {fieldErrors.refCode && (
              <p className="mt-1.5 text-xs font-bold text-danger">{fieldErrors.refCode}</p>
            )}
          </div>
        )}

        {tab === 'signup' && (
          <div>
            <label
              htmlFor="auth-age"
              className="flex cursor-pointer items-start gap-2.5 text-sm text-tx-sec"
            >
              <input
                id="auth-age"
                type="checkbox"
                checked={ageOk}
                onChange={(e) => {
                  setAgeOk(e.target.checked);
                  if (fieldErrors.age) setFieldErrors((f) => ({ ...f, age: undefined }));
                }}
                aria-describedby={fieldErrors.age ? 'auth-age-error' : undefined}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-line bg-surface-3 accent-green"
              />
              <span>
                I am 18 or older and accept the{' '}
                <Link
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-green underline-offset-2 hover:underline"
                >
                  Terms
                </Link>
                .
              </span>
            </label>
            {fieldErrors.age && (
              <p id="auth-age-error" className="mt-1.5 text-xs font-bold text-danger">
                {fieldErrors.age}
              </p>
            )}
          </div>
        )}

        {/* v8 — captcha (renders nothing until the owner adds the free
            Cloudflare Turnstile keys; then it gates account creation). */}
        {tab === 'signup' && open && <Turnstile onToken={setCaptchaToken} />}

        {geoBlock && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger/10 p-4"
          >
            <Globe className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
            <div className="space-y-1.5 text-sm leading-relaxed text-tx-sec">
              <p className="font-bold text-tx">
                Callitnow is not available in {geoBlock}.
              </p>
              <p>
                You appear to be connecting from {geoBlock}, where local rules do
                not allow us to offer accounts. You are welcome to keep browsing
                markets and prices, but you cannot create an account, trade or
                deposit from where you are. See our{' '}
                <Link
                  href="/about#legal"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-tx underline-offset-2 hover:underline"
                >
                  legal status
                </Link>{' '}
                page for details.
              </p>
            </div>
          </div>
        )}

        {storeError && (
          <p role="alert" className="text-sm font-bold text-danger">
            {storeError}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={loading}
          disabled={
            tab === 'signup' &&
            (Boolean(geoBlock) || !ageOk || (turnstileRequired && !captchaToken))
          }
          className="w-full"
        >
          {tab === 'signin' ? 'Sign in' : 'Create account'}
        </Button>
      </form>
    </Modal>
  );
}
