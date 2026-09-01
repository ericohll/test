import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import * as cognito from './cognito.js';
import {
  restoreSession,
  saveSession,
  clearSession,
  signOut as sessionSignOut,
  canEditThresholds as canEditThresholdsFor,
  getState,
} from './session.js';

const AuthContext = createContext(null);

const ROLE_PRIORITY = ['ReleaseManager', 'QALead', 'Viewer'];

function roleLabelFor(groups) {
  return ROLE_PRIORITY.find((role) => groups.includes(role)) || 'Viewer';
}

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('booting');
  const [identity, setIdentity] = useState({ email: null, groups: [] });

  useEffect(() => {
    let mounted = true;
    restoreSession().then((result) => {
      if (!mounted) return;
      const s = getState();
      setIdentity({ email: s.email, groups: s.groups });
      setStatus(result.status);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const applySession = useCallback((authResult) => {
    const s = saveSession(authResult);
    setIdentity({ email: s.email, groups: s.groups });
    setStatus('authenticated');
  }, []);

  const signIn = useCallback(
    async (email, password) => {
      const result = await cognito.initiateAuthPassword(email, password);
      if (!result.AuthenticationResult) {
        throw Object.assign(new Error(`Unsupported sign-in challenge: ${result.ChallengeName}`), {
          code: 'UnsupportedChallenge',
        });
      }
      applySession(result.AuthenticationResult);
    },
    [applySession],
  );

  const signUp = useCallback((email, password) => cognito.signUp(email, password), []);

  const confirmSignUp = useCallback((email, code) => cognito.confirmSignUp(email, code), []);

  const resendCode = useCallback((email) => cognito.resendConfirmationCode(email), []);

  const signOut = useCallback(() => {
    clearSession();
    setIdentity({ email: null, groups: [] });
    setStatus('anonymous');
    sessionSignOut();
  }, []);

  const value = useMemo(
    () => ({
      status,
      email: identity.email,
      groups: identity.groups,
      roleLabel: roleLabelFor(identity.groups),
      canEditThresholds: canEditThresholdsFor(identity.groups),
      signIn,
      signUp,
      confirmSignUp,
      resendCode,
      signOut,
    }),
    [status, identity, signIn, signUp, confirmSignUp, resendCode, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() must be used within an AuthProvider');
  return ctx;
}
