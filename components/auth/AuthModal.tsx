'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import Modal from '@/components/ui/modal';
import Tabs from '@/components/ui/tabs';
import Input from '@/components/ui/input';
import Button from '@/components/ui/button';
import { useCallitStore } from '@/lib/store';

type AuthTab = 'signin' | 'signup';

const TAB_ITEMS: { value: AuthTab; label: string }[] = [
  { value: 'signin', label: 'Sign in' },
  { value: 'signup', label: 'Sign up' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FieldErrors {
  email?: string;
  username?: string;
  password?: string;
  age?: string;
}

/**
 * Normalizes auth errors from the store (local demo mode) and Supabase
 * into short, consistent UI copy. Unknown errors pass through verbatim.
 */
function mapAuthError(error?: string): string {
  if (!error) return 'Something went wrong. Please try again.';
  const e = error.toLowerCase();
  if (e.includes('already')) return 'Email already registered';
  // Supabase email validation ("Email address ... is invalid") must not be
  // collapsed into a credentials error — tell the user what to fix.
  if (e.includes('invalid') && e.includes('email'))
    return 'Please enter a valid email address.';
  if (e.includes('invalid')) return 'Invalid credentials';
  if (e.includes('banned')) return 'Account banned';
  return error;
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

  const [tab, setTab] = useState<AuthTab>(defaultTab);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // Age + terms gate (sign-up only). Never pre-checked: the confirmation is
  // worthless if the default answers for the user.
  const [ageOk, setAgeOk] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [storeError, setStoreError] = useState<string | null>(null);

  // Fresh form every time the modal opens, on the requested tab.
  useEffect(() => {
    if (!open) return;
    setTab(defaultTab);
    setEmail('');
    setUsername('');
    setPassword('');
    setAgeOk(false);
    setFieldErrors({});
    setStoreError(null);
    setLoading(false);
  }, [open, defaultTab]);

  const switchTab = (next: AuthTab) => {
    setTab(next);
    setAgeOk(false);
    setFieldErrors({});
    setStoreError(null);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading) return;

    const errors: FieldErrors = {};
    if (!EMAIL_RE.test(email.trim())) {
      errors.email = 'Enter a valid email address.';
    }
    if (tab === 'signup') {
      const un = username.trim();
      if (un.length < 3 || un.length > 20) {
        errors.username = 'Username must be 3-20 characters.';
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
    if (Object.keys(errors).length > 0) return;

    setLoading(true);
    const result =
      tab === 'signin'
        ? await signIn(email, password)
        : await signUp(email, username, password);
    setLoading(false);

    if (result.ok) {
      if (result.info) {
        // e.g. Supabase email confirmation is enabled — account created
        // but not signed in yet.
        toast.info(result.info);
      } else {
        toast.success(tab === 'signin' ? 'Welcome back' : 'Account created');
      }
      onClose();
    } else {
      setStoreError(mapAuthError(result.error));
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
            }}
            placeholder="you@example.com"
            autoComplete="email"
            error={Boolean(fieldErrors.email)}
          />
          {fieldErrors.email && (
            <p className="mt-1.5 text-xs font-bold text-danger">{fieldErrors.email}</p>
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
              maxLength={20}
              error={Boolean(fieldErrors.username)}
            />
            {fieldErrors.username && (
              <p className="mt-1.5 text-xs font-bold text-danger">{fieldErrors.username}</p>
            )}
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
          disabled={tab === 'signup' && !ageOk}
          className="w-full"
        >
          {tab === 'signin' ? 'Sign in' : 'Create account'}
        </Button>
      </form>
    </Modal>
  );
}
