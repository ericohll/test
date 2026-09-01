import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { Field, TextInput, PasswordInput, Button, ButtonRow } from '../components/Form.jsx';
import { Banner } from '../components/Feedback.jsx';
import config from '../config.js';

// PreventUserExistenceErrors: ENABLED on the user pool client means Cognito
// deliberately returns NotAuthorizedException for both "wrong password" and
// "no such user" -- the copy below must stay just as generic, or it would
// leak which emails are registered.
const ERROR_COPY = {
  NotAuthorizedException: 'Incorrect email or password.',
  UsernameExistsException: 'An account with that email already exists — sign in instead.',
  CodeMismatchException: 'That code is not valid.',
  ExpiredCodeException: 'That code has expired — request a new one.',
  LimitExceededException: 'Too many attempts — wait a minute and try again.',
  TooManyRequestsException: 'Too many attempts — wait a minute and try again.',
};

function describeError(err) {
  const code = err?.code;
  if (code && ERROR_COPY[code]) return ERROR_COPY[code];
  if (code === 'InvalidPasswordException' || code === 'InvalidParameterException') {
    return err.message;
  }
  if (code) return `${code}: ${err.message}`;
  return err?.message || 'Something went wrong. Please try again.';
}

export default function LoginPage() {
  const { signIn, signUp, confirmSignUp, resendCode } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = useState('signIn'); // signIn | signUp | confirm
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  if (!config.isConfigured) {
    const missing = [
      !config.apiUrl && 'VITE_API_URL',
      !config.userPoolClientId && 'VITE_USER_POOL_CLIENT_ID',
      !config.region && 'VITE_REGION',
    ].filter(Boolean);
    return (
      <div className="qd-auth-page">
        <div className="qd-auth-card">
          <h1 className="qd-auth-title">Configuration missing</h1>
          <p className="qd-auth-subtitle">
            This build is missing required environment variables: {missing.join(', ')}. Set them in
            frontend/.env.production and rebuild.
          </p>
        </div>
      </div>
    );
  }

  const goAfterSignIn = () => {
    const dest = location.state?.from?.pathname || '/portfolio';
    navigate(dest, { replace: true });
  };

  const handleSignIn = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      goAfterSignIn();
    } catch (err) {
      if (err.code === 'UserNotConfirmedException') {
        setMode('confirm');
        setNotice('Please confirm your account with the code we emailed you.');
      } else {
        setError(describeError(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSignUp = async (e) => {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await signUp(email, password);
      setMode('confirm');
      setNotice(`We emailed a 6-digit code to ${email}`);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await confirmSignUp(email, code);
      if (password) {
        await signIn(email, password);
        goAfterSignIn();
      } else {
        setMode('signIn');
        setNotice('Account confirmed — sign in to continue.');
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    setBusy(true);
    setError(null);
    try {
      await resendCode(email);
      setNotice(`We sent a new code to ${email}`);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="qd-auth-page">
      <div className="qd-auth-card">
        <h1 className="qd-auth-title">Quality Dashboard</h1>
        <p className="qd-auth-subtitle">
          {mode === 'signIn' && 'Sign in to view portfolio quality data.'}
          {mode === 'signUp' && 'Create an account to get started.'}
          {mode === 'confirm' && 'Enter the confirmation code we emailed you.'}
        </p>

        {error ? <Banner variant="error">{error}</Banner> : null}
        {notice ? <Banner variant="info">{notice}</Banner> : null}

        {mode === 'signIn' && (
          <form onSubmit={handleSignIn}>
            <Field label="Email">
              <TextInput value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </Field>
            <Field label="Password">
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <ButtonRow>
              <Button type="submit" disabled={busy}>
                Sign in
              </Button>
            </ButtonRow>
          </form>
        )}

        {mode === 'signUp' && (
          <form onSubmit={handleSignUp}>
            <Field label="Email">
              <TextInput value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </Field>
            <Field label="Password">
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <Field label="Confirm password">
              <PasswordInput value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
            </Field>
            <ButtonRow>
              <Button type="submit" disabled={busy}>
                Sign up
              </Button>
            </ButtonRow>
          </form>
        )}

        {mode === 'confirm' && (
          <form onSubmit={handleConfirm}>
            <Field label="Email">
              <TextInput value={email} readOnly disabled />
            </Field>
            <Field label="Confirmation code">
              <TextInput value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
            </Field>
            <ButtonRow>
              <Button type="submit" disabled={busy}>
                Confirm
              </Button>
              <Button type="button" variant="link" onClick={handleResend} disabled={busy}>
                Resend code
              </Button>
            </ButtonRow>
          </form>
        )}

        <div className="qd-auth-switch">
          {mode !== 'signIn' && (
            <button
              className="qd-button-link"
              onClick={() => {
                setMode('signIn');
                setError(null);
                setNotice(null);
              }}
            >
              Back to sign in
            </button>
          )}
          {mode === 'signIn' && (
            <button
              className="qd-button-link"
              onClick={() => {
                setMode('signUp');
                setError(null);
                setNotice(null);
              }}
            >
              Need an account? Sign up
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
