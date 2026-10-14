import { useCallback, useEffect, useRef, useState } from 'react';
import CardPreview from '../creator/CardPreview.jsx';
import CardReveal from './CardReveal.jsx';
import UnlockScreen from './UnlockScreen.jsx';
import './recipient-card.css';
import { STICKERS, STICKER_POSITIONS } from '../../../../shared/mediaOptions.js';
import { DESIGN_CHOICES, STICKER_SIZES, STICKER_ROTATIONS } from '../../../../shared/designOptions.js';

const PUBLIC_CARD_FIELDS = [
  'occasion', 'recipientName', 'title', 'message', 'theme',
  'font', 'fontSize', 'alignment',
];

// Check the response shape before passing it to the shared card renderer.
function isPublicCard(card, shareToken) {
  return card !== null
    && typeof card === 'object'
    && PUBLIC_CARD_FIELDS.every((field) => typeof card[field] === 'string')
    && (card.textColor === null || typeof card.textColor === 'string')
    && card.message.trim().length > 0
    && (card.design === undefined || (card.design !== null && typeof card.design === 'object'
      && !Array.isArray(card.design) && Object.entries(card.design).every(([key, value]) =>
        Object.hasOwn(DESIGN_CHOICES, key) && DESIGN_CHOICES[key].some((choice) => choice.id === value))))
    && (card.photos === undefined || (Array.isArray(card.photos) && card.photos.length <= 4
      && card.photos.every((photo) => photo && /^[A-Za-z0-9_-]{32}$/.test(photo.id)
        && photo.url === `/api/cards/${shareToken}/media/${photo.id}`)))
    && (card.stickers === undefined || (Array.isArray(card.stickers) && card.stickers.length <= 5
      && card.stickers.every((sticker) => sticker && STICKERS.some((choice) => choice.id === sticker.id)
        && STICKER_POSITIONS.some((choice) => choice.id === sticker.position)
        && (sticker.size === undefined || STICKER_SIZES.some((choice) => choice.id === sticker.size))
        && (sticker.rotation === undefined || STICKER_ROTATIONS.includes(sticker.rotation)))));
}

function isLockedCard(data) {
  return data?.protection?.enabled === true && Array.isArray(data.protection.hints)
    && data.protection.hints.length <= 2
    && data.protection.hints.every((hint) => typeof hint === 'string' && hint.length <= 400);
}

export default function RecipientCardPage({ shareToken }) {
  const [page, setPage] = useState({ status: 'loading', shareToken });
  const [retryCount, setRetryCount] = useState(0);
  const [connectionNotice, setConnectionNotice] = useState(false);
  const [isCheckingAccess, setIsCheckingAccess] = useState(false);
  const heading = useRef(null);
  const pendingRequest = useRef(null);
  const generation = useRef(0);
  const lastCheck = useRef(0);
  const photoCheckQueued = useRef(false);
  const photoCheckTimer = useRef(null);
  const currentPage = useRef(page);
  currentPage.current = page;
  // A new route must never briefly display the previous route's card.
  const visiblePage = page.shareToken === shareToken ? page : { status: 'loading' };

  useEffect(() => {
    if (page.status === 'ready' && page.revealed) heading.current?.focus();
  }, [page.status, page.revealed]);

  function showUnlockedCard(card) {
    if (!isPublicCard(card, shareToken)) throw new Error('We couldn’t open your card just yet. Please try again.');
    generation.current += 1;
    pendingRequest.current?.abort();
    pendingRequest.current = null;
    window.clearTimeout(photoCheckTimer.current);
    photoCheckTimer.current = null;
    photoCheckQueued.current = false;
    setConnectionNotice(false);
    // This is display state; the server has already verified the code.
    setPage({ status: 'ready', card, unlocked: true, shareToken });
  }

  const finishReveal = useCallback(() => {
    setPage((current) => current.status === 'ready' && !current.revealed
      ? { ...current, revealed: true } : current);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    pendingRequest.current?.abort();
    pendingRequest.current = controller;
    const version = ++generation.current;
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    const isCurrent = () => generation.current === version && pendingRequest.current === controller;
    setPage({ status: 'loading', shareToken });
    setConnectionNotice(false);
    setIsCheckingAccess(false);
    lastCheck.current = 0;
    photoCheckQueued.current = false;

    async function loadCard() {
      try {
        const response = await fetch(`/api/cards/${encodeURIComponent(shareToken)}`, { signal: controller.signal });
        if (response.status === 404) {
          if (isCurrent()) setPage({ status: 'not-found', shareToken });
          return;
        }
        if (!response.ok) throw new Error('Card request failed');
        const data = await response.json();
        if (isLockedCard(data)) {
          if (isCurrent()) setPage({ status: 'locked', hints: data.protection.hints, shareToken });
          return;
        }
        if (!isPublicCard(data?.card, shareToken)) throw new Error('Invalid card response');
        if (isCurrent()) setPage({ status: 'ready', card: data.card, shareToken });
      } catch {
        if (isCurrent()) setPage({ status: 'error', shareToken });
      } finally {
        window.clearTimeout(timeout);
        if (pendingRequest.current === controller) pendingRequest.current = null;
      }
    }
    loadCard();

    return () => {
      generation.current += 1;
      window.clearTimeout(timeout);
      controller.abort();
      pendingRequest.current?.abort();
      pendingRequest.current = null;
      window.clearTimeout(photoCheckTimer.current);
      photoCheckTimer.current = null;
      photoCheckQueued.current = false;
    };
  }, [shareToken, retryCount]);

  const checkAccess = useCallback(async function verifyAccess(manual = false, photoFailure = false) {
    if (currentPage.current.status !== 'ready' || currentPage.current.shareToken !== shareToken) return;
    if (pendingRequest.current) {
      if (photoFailure) photoCheckQueued.current = true;
      return;
    }
    const wait = 1200 - (Date.now() - lastCheck.current);
    if (!manual && wait > 0) {
      if (photoFailure && photoCheckTimer.current === null) {
        photoCheckTimer.current = window.setTimeout(() => {
          photoCheckTimer.current = null;
          verifyAccess(false, true);
        }, wait);
      }
      return;
    }
    photoCheckQueued.current = false;
    window.clearTimeout(photoCheckTimer.current);
    photoCheckTimer.current = null;
    lastCheck.current = Date.now();
    const controller = new AbortController();
    pendingRequest.current = controller;
    const version = generation.current;
    const isCurrent = () => generation.current === version && pendingRequest.current === controller;
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    setIsCheckingAccess(true);
    try {
      const response = await fetch(`/api/cards/${encodeURIComponent(shareToken)}`, { signal: controller.signal });
      if (response.status === 404) {
        if (isCurrent()) setPage({ status: 'not-found', shareToken });
        return;
      }
      if (!response.ok) throw new Error('Access check failed');
      const data = await response.json();
      if (isLockedCard(data)) {
        if (isCurrent()) {
          setConnectionNotice(false);
          // Remove the old content before asking for the code again.
          setPage({ status: 'locked', hints: data.protection.hints, accessExpired: true, shareToken });
        }
        return;
      }
      if (!isPublicCard(data?.card, shareToken)) throw new Error('Invalid card response');
      // A successful check leaves the current card and reveal exactly as they are.
      if (isCurrent()) {
        setConnectionNotice(false);
        if (manual) heading.current?.focus();
      }
    } catch {
      if (isCurrent()) setConnectionNotice(true);
    } finally {
      window.clearTimeout(timeout);
      const wasCurrent = isCurrent();
      if (wasCurrent) setIsCheckingAccess(false);
      if (pendingRequest.current === controller) pendingRequest.current = null;
      // A photo failure during another check gets one follow-up after it settles.
      if (wasCurrent && photoCheckQueued.current) {
        photoCheckQueued.current = false;
        photoCheckTimer.current = window.setTimeout(() => {
          photoCheckTimer.current = null;
          verifyAccess(false, true);
        }, Math.max(0, 1200 - (Date.now() - lastCheck.current)));
      }
    }
  }, [shareToken]);

  useEffect(() => {
    if (page.status !== 'ready') return;
    const onFocus = () => { if (document.visibilityState === 'visible') checkAccess(); };
    const onVisible = () => { if (document.visibilityState === 'visible') checkAccess(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [page.status, checkAccess]);

  return (
    <div className="recipient-page"
      data-theme={visiblePage.status === 'ready' ? visiblePage.card.theme : undefined}
      data-occasion={visiblePage.status === 'ready' ? visiblePage.card.occasion : undefined}>
      <header className="recipient-header">
        <a className="recipient-brand" href="/" aria-label="Emotale home">
          <span className="recipient-brand-mark" aria-hidden="true">✦</span> Emotale
        </a>
      </header>

      <main className="recipient-main" aria-busy={visiblePage.status === 'loading'}>
        {visiblePage.status === 'loading' && (
          <section className="recipient-notice recipient-loading" role="status">
            <div className="recipient-loading-envelope" aria-hidden="true"><span>♥</span></div>
            <p className="recipient-eyebrow">A card made for you</p>
            <h1>A little something is on its way.</h1>
            <p>Opening your card…</p>
          </section>
        )}

        {visiblePage.status === 'not-found' && (
          <section className="recipient-notice" role="status">
            <span className="recipient-notice-icon" aria-hidden="true">💌</span>
            <h1>This card couldn’t be found</h1>
            <p>This link may be incomplete, or the card may no longer be available. Ask the sender to share it again.</p>
            <a className="recipient-action" href="/">Create a card</a>
          </section>
        )}

        {visiblePage.status === 'error' && (
          <section className="recipient-notice" role="alert">
            <span className="recipient-notice-icon" aria-hidden="true">💌</span>
            <h1>We couldn’t open your card just yet</h1>
            <p>Please try again in a moment.</p>
            <button className="recipient-action" type="button" onClick={() => setRetryCount((count) => count + 1)}>Try again</button>
          </section>
        )}

        {visiblePage.status === 'locked' && (
          <UnlockScreen shareToken={shareToken} hints={visiblePage.hints}
            accessExpired={visiblePage.accessExpired} onUnlocked={showUnlockedCard} />
        )}

        {visiblePage.status === 'ready' && (
          <>
            <div className="recipient-intro">
              <p className="recipient-eyebrow">Made with a little love</p>
              <h1 ref={heading} tabIndex={-1}>A little something, just for you.</h1>
              {visiblePage.revealed && <p className="sr-only" role="status">
                {visiblePage.unlocked ? 'Your card is unlocked and ready to read.' : 'Your card is ready to read.'}
              </p>}
            </div>
            {connectionNotice && (
              <div className="recipient-connection-notice" role="status">
                <p>We couldn’t check your connection. Your card is still here.</p>
                <button type="button" onClick={() => checkAccess(true)} disabled={isCheckingAccess}>
                  {isCheckingAccess ? 'Checking…' : 'Retry connection'}
                </button>
              </div>
            )}
            <CardReveal card={visiblePage.card} onRevealed={finishReveal}>
              <CardPreview card={visiblePage.card} accessibleLabel="Your card" onPhotoError={() => checkAccess(false, true)} />
            </CardReveal>
            <p className="recipient-closing">Some words are worth keeping close.</p>
          </>
        )}
      </main>
    </div>
  );
}
