import { useEffect, useRef, useState } from 'react';
import {
  buildShareLinks, buildShareUrl, DEFAULT_SHARE_MESSAGE, MAX_SHARE_MESSAGE,
} from '../../../../shared/shareLinks.js';
import ShareCardSummary from './ShareCardSummary.jsx';
import './card-created.css';

export default function CardCreatedPage({ cardPath, preview, isProtected = false, onCreateAnother }) {
  const linkInput = useRef(null);
  const title = useRef(null);
  const copyInProgress = useRef(false);
  const nativeShareInProgress = useRef(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const [nativeSharing, setNativeSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState(DEFAULT_SHARE_MESSAGE);
  const [feedback, setFeedback] = useState('');
  let shareUrl = '';
  let shareLinks = null;
  try {
    shareUrl = buildShareUrl(cardPath, window.location.origin);
    shareLinks = buildShareLinks(shareUrl, shareMessage);
  } catch {
    // An unexpected path must never become an external share or open-card link.
  }
  let nativeShareSupported = false;
  if (shareLinks && typeof navigator.share === 'function') {
    try {
      nativeShareSupported = typeof navigator.canShare !== 'function' || navigator.canShare(shareLinks.native);
    } catch {
      nativeShareSupported = false;
    }
  }
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

  useEffect(() => {
    window.scrollTo(0, 0);
    title.current?.focus();
  }, []);

  function selectLink() {
    linkInput.current?.focus();
    linkInput.current?.select();
    setFeedback('Select and copy the link above.');
  }

  async function copyLink() {
    if (!shareUrl || copyInProgress.current || nativeShareInProgress.current) return;
    copyInProgress.current = true;
    setCopying(true);
    setCopied(false);
    setManualCopy(false);
    setFeedback('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setFeedback('Link copied!');
    } catch {
      setManualCopy(true);
      selectLink();
    } finally {
      copyInProgress.current = false;
      setCopying(false);
    }
  }

  async function shareNative() {
    if (!nativeShareSupported || !shareLinks || nativeShareInProgress.current || copyInProgress.current) return;
    nativeShareInProgress.current = true;
    setNativeSharing(true);
    setFeedback('');
    try {
      // Call directly from this click so the browser can open its share dialog.
      await navigator.share(shareLinks.native);
      setFeedback('Share dialog opened.');
    } catch (error) {
      setFeedback(error?.name === 'AbortError'
        ? 'Sharing canceled.'
        : 'Sharing did not work. Try one of the options below or copy the link.');
    } finally {
      nativeShareInProgress.current = false;
      setNativeSharing(false);
    }
  }

  return (
    <main className="card-created-page">
      <div className="created-brand"><span aria-hidden="true">✦</span> Emotale</div>
      <section className="created-panel" aria-labelledby="created-title">
        <div className="created-illustration" aria-hidden="true">💌</div>
        <p className="created-eyebrow">Little messages. Lasting feelings.</p>
        <h1 id="created-title" ref={title} tabIndex={-1}>Your card is ready!</h1>
        <p className="created-description">A link to a little moment made just for them.</p>
        <ShareCardSummary card={preview} isProtected={isProtected} />
        {!shareLinks && <p className="created-share-error" role="alert">We could not prepare the card link. Create another card to try again.</p>}
        <label className="created-link-label" htmlFor="created-link">Card link</label>
        <input id="created-link" ref={linkInput} className="created-link-input" value={shareUrl} readOnly />
        <div className="created-actions">
          <button className="created-copy-button" type="button" onClick={copyLink}
            disabled={!shareUrl || copying || nativeSharing} aria-busy={copying}>
            {copying ? 'Copying…' : copied ? 'Copied ✓' : 'Copy Link'}
          </button>
          {shareUrl && <a className="created-open-link" href={cardPath} target="_blank" rel="noopener noreferrer">
            Open Card<span className="sr-only"> (opens in a new tab)</span>
          </a>}
        </div>
        {manualCopy && <button className="created-select-button" type="button" onClick={selectLink}
          disabled={copying || nativeSharing}>Select link</button>}
        <p className="created-feedback" role="status" aria-live="polite">{feedback}</p>
        {shareLinks && <section className="created-sharing" aria-labelledby="created-sharing-heading">
          <h2 id="created-sharing-heading">Send a little moment</h2>
          <div className="created-share-message">
            <label className="created-link-label" htmlFor="created-share-message">Message to send with your link</label>
            <textarea id="created-share-message" className="created-share-message-input" value={shareMessage}
              maxLength={MAX_SHARE_MESSAGE} rows={2} aria-describedby="created-share-message-note"
              onChange={(event) => setShareMessage(event.target.value)} />
            <div className="created-share-message-meta">
              <p id="created-share-message-note">This message goes with the link. Your card stays as you made it.</p>
              <span>{shareMessage.length}/{MAX_SHARE_MESSAGE}</span>
            </div>
          </div>
          {nativeShareSupported && <button className="created-native-button" type="button" onClick={shareNative}
            disabled={nativeSharing || copying} aria-busy={nativeSharing}>
            {nativeSharing ? 'Opening share options…' : 'Share'}
          </button>}
          <nav className="created-share-options" aria-label="Share your card">
            <a href={shareLinks.whatsapp} target="_blank" rel="noopener noreferrer">WhatsApp<span className="sr-only"> (opens in a new tab)</span></a>
            <a href={shareLinks.email}>Email</a>
            <a href={shareLinks.x} target="_blank" rel="noopener noreferrer">X<span className="sr-only"> (opens in a new tab)</span></a>
          </nav>
        </section>}
        {isProtected && <p className="created-local-note">Share the secret code separately with your recipient.</p>}
        {isLocal && <p className="created-local-note">This local link works on this computer. Public sharing will be available when the app is hosted.</p>}
        <button className="created-another-button" type="button" onClick={onCreateAnother}>Create another card</button>
      </section>
    </main>
  );
}
