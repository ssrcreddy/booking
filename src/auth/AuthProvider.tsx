import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { neon } from '../lib/neon';
import type { User } from '../types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthResult {
  error?: { message?: string } | null;
}

function check(result: AuthResult, fallback: string): void {
  if (result.error) throw new Error(result.error.message || fallback);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSession = useCallback(async () => {
    try {
      const { data } = await neon.auth.getSession();
      const u = data?.user;
      setUser(u ? { id: u.id, name: u.name ?? '', email: u.email ?? '' } : null);
    } catch (err) {
      console.error('Failed to load session', err);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      async signIn(email, password) {
        check(await neon.auth.signIn.email({ email, password }), 'Sign in failed.');
        await loadSession();
      },
      async signUp(name, email, password) {
        check(await neon.auth.signUp.email({ name, email, password }), 'Sign up failed.');
        await loadSession();
      },
      async signInWithGoogle() {
        // Redirects to Google, then back to this origin.
        check(
          await neon.auth.signIn.social({ provider: 'google', callbackURL: window.location.origin }),
          'Google sign in failed.',
        );
      },
      async signOut() {
        await neon.auth.signOut();
        setUser(null);
      },
    }),
    [user, loading, loadSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
