import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { subscribeToProject } from '../api/endpoints.js';
import { Card, CardHeader } from './Card.jsx';
import { Field, TextInput, Button, ButtonRow } from './Form.jsx';
import { Banner } from './Feedback.jsx';

export default function SubscribePanel({ projectId }) {
  const { email: myEmail } = useAuth();
  const [email, setEmail] = useState(myEmail || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      await subscribeToProject({ project_id: projectId, email });
      setSuccess('Confirmation email sent — check your inbox and confirm the SNS subscription.');
    } catch (err) {
      setError(err.message || 'Could not create the subscription.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Notify me on gate breaches" />
      {error ? <Banner variant="error">{error}</Banner> : null}
      {success ? <Banner variant="success">{success}</Banner> : null}
      <form onSubmit={submit}>
        <Field label="Email">
          <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <ButtonRow>
          <Button type="submit" disabled={busy}>
            Subscribe
          </Button>
        </ButtonRow>
      </form>
    </Card>
  );
}
