import { useEffect, useRef, useState } from 'react';
import { unlockCard } from '../../api/cards.js';
import './unlock-screen.css';

export default function UnlockScreen({ shareToken, hints, onUnlocked, accessExpired = false }) {
  const [code, setCode] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [error, setError] = useState('');
  const [waitUntil, setWaitUntil] = useState(0);
  const [waitSeconds, setWaitSeconds] = useState(0);
  const request = useRef(null);
  const codeInput = useRef(null);

  useEffect(() => {
    if (accessExpired) codeInput.current?.focus();
  }, [accessExpired]);

  useEffect(() => () => {
    const pending = request.current;
    request.current = null;
    pending?.abort();
  }, []);

  useEffect(() => {
    if (!waitUntil) return;
    const updateWait = () => setWaitSeconds(Math.max(0, Math.ceil((waitUntil - Date.now()) / 1000)));
    updateWait();
    const interval = window.setInterval(updateWait, 1000);
    return () => window.clearInterval(interval);
  }, [waitUntil]);

  useEffect(() => {
    if (error && !isUnlocking && waitSeconds === 0) codeInput.current?.focus();
  }, [error, isUnlocking, waitSeconds]);

  async function handleUnlock(event) {
    event.preventDefault();
    if (request.current || waitUntil > Date.now()) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    setIsUnlocking(true);
    setError('');
    try {
      const card = await unlockCard(shareToken, code, controller.signal);
      if (controller.signal.aborted) return;
      onUnlocked(card);
      setCode('');
    } catch (failure) {
      // An unmounted screen has no UI to update. A timeout still shows a retry.
      if (request.current !== controller) return;
      setError(failure.message);
      if (failure.retryAfter) {
        setWaitSeconds(failure.retryAfter);
        setWaitUntil(Date.now() + failure.retryAfter * 1000);
      }
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        setIsUnlocking(false);
      }
    }
  }

  return (
    <section className="unlock-screen" aria-labelledby="unlock-heading">
      <span className="unlock-envelope" aria-hidden="true">💌</span>
      <p className="recipient-eyebrow">A little secret, just for you</p>
      <h1 id="unlock-heading">Someone has a little surprise for you.</h1>
      <p className="unlock-description">There’s a secret waiting inside. Enter the code from your sender to open it.</p>

      {accessExpired && <p className="unlock-access-expired" id="unlock-access-notice" role="alert">
        Your access has expired. Enter the code to open your card again.
      </p>}

      {hints.length > 0 && (
        <div className="unlock-hints" aria-label="Hints from your sender">
          <p className="unlock-hints-label">A little clue{hints.length > 1 ? ' or two' : ''} ✨</p>
          <ul>{hints.map((hint, index) => <li key={index}>{hint}</li>)}</ul>
        </div>
      )}

      <form className="unlock-form" onSubmit={handleUnlock} aria-busy={isUnlocking}>
        <label htmlFor="unlock-code">Secret code</label>
        <input
          ref={codeInput}
          id="unlock-code"
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          required
          maxLength={256}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          disabled={isUnlocking || waitSeconds > 0}
          aria-describedby={accessExpired ? 'unlock-code-help unlock-access-notice' : 'unlock-code-help'}
        />
        <p id="unlock-code-help" className="unlock-code-help">Codes are case-sensitive. Your sender can help if you’re unsure.</p>
        {error && <p className="unlock-error" role="alert">{error}</p>}
        {waitSeconds > 0 && <p className="unlock-wait">Try again in {waitSeconds} second{waitSeconds === 1 ? '' : 's'}.</p>}
        <button className="recipient-action unlock-button" type="submit" disabled={isUnlocking || waitSeconds > 0}>
          {isUnlocking ? 'Opening your surprise…' : <>Unlock <span aria-hidden="true">💌</span></>}
        </button>
      </form>
      <p className="unlock-footer">A small secret. A thoughtful little moment.</p>
    </section>
  );
}
