import { useEffect, useRef, useState } from 'react';
import useReducedMotion from './useReducedMotion.js';
import { getRecipientAtmosphere } from './recipientAtmosphere.js';
import './card-reveal.css';

function Decorations({ atmosphere }) {
  return (
    <div className="reveal-decorations" data-decoration={atmosphere.decoration} aria-hidden="true">
      {Array.from({ length: atmosphere.count }, (_, index) => (
        <span className="reveal-decoration" key={index} style={{ '--decoration-index': index }}>
          {atmosphere.decoration === 'hearts' ? '♥' : atmosphere.decoration === 'stars' ? '✦' : ''}
        </span>
      ))}
    </div>
  );
}

export default function CardReveal({ card, children, onRevealed }) {
  const reducedMotion = useReducedMotion();
  const [motionDisabled, setMotionDisabled] = useState(reducedMotion);
  const [phase, setPhase] = useState(() => reducedMotion ? 'ready' : 'opening');
  const [skipped, setSkipped] = useState(false);
  const timer = useRef(null);
  const notified = useRef(false);
  const userInitiated = useRef(false);
  const onRevealedRef = useRef(onRevealed);
  const atmosphere = getRecipientAtmosphere(card);
  const motionOff = reducedMotion || motionDisabled;
  const ready = motionOff || phase === 'ready';

  useEffect(() => { onRevealedRef.current = onRevealed; }, [onRevealed]);

  useEffect(() => {
    // Once motion is stopped, keep this card still. Turning the preference off
    // can enable future cards without replaying one that is already open.
    if (reducedMotion) setMotionDisabled(true);
  }, [reducedMotion]);

  useEffect(() => {
    if (motionOff) {
      setPhase('ready');
      return undefined;
    }
    if (phase === 'ready') return undefined;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setPhase('ready');
    }, atmosphere.openingMs);
    return () => {
      window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [motionOff, phase, atmosphere.openingMs]);

  useEffect(() => {
    // Effects run after the card DOM has mounted. The ref also prevents a
    // duplicate announcement when React StrictMode checks effect cleanup.
    if (ready && !notified.current) {
      notified.current = true;
      onRevealedRef.current?.({ userInitiated: userInitiated.current });
    }
  }, [ready]);

  function openNow() {
    userInitiated.current = true;
    window.clearTimeout(timer.current);
    timer.current = null;
    setSkipped(true);
    setPhase('ready');
  }

  return (
    <div
      className="recipient-card-stage card-reveal"
      data-reveal-state={ready ? 'ready' : 'opening'}
      data-theme={atmosphere.theme}
      data-occasion={atmosphere.occasion}
      data-motion={motionOff ? 'reduced' : atmosphere.motion}
      data-skipped={skipped ? 'true' : 'false'}
      data-atmosphere={atmosphere.decoration}
      aria-busy={!ready}
      style={{ '--reveal-opening-ms': `${atmosphere.openingMs}ms`, '--reveal-message-ms': `${atmosphere.messageMs}ms` }}
    >
      {ready ? (
        <>
          {!motionOff && !skipped && <Decorations atmosphere={atmosphere} />}
          <div className="reveal-content">{children}</div>
        </>
      ) : (
        <div className="reveal-opening">
          <div className="reveal-envelope" aria-hidden="true">
            <div className="reveal-envelope-letter">
              <span className="reveal-letter-mark">{atmosphere.decoration === 'hearts' ? '♥' : '✦'}</span>
              <span className="reveal-letter-line" />
              <span className="reveal-letter-line short-line" />
            </div>
            <div className="reveal-envelope-front" />
            <div className="reveal-envelope-flap" />
            <span className="reveal-envelope-seal">✦</span>
          </div>
          <p className="reveal-opening-note" role="status">Opening a little something, just for you…</p>
          <button className="reveal-open-now" type="button" onClick={openNow}>Open now</button>
        </div>
      )}
    </div>
  );
}
