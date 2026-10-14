import { useCallback, useEffect, useRef, useState } from 'react';
import './health-check.css';

const initialConnection = {
  backend: 'checking',
  database: 'checking',
  storage: 'checking',
  checkedAt: null,
  message: 'Checking the backend, database, and photo storage…',
};

function StatusRow({ name, description, status, label }) {
  return (
    <li className="status-row">
      <div>
        <h2>{name}</h2>
        <p>{description}</p>
      </div>
      <span className={`status-badge status-${status}`}>
        <span className="status-dot" aria-hidden="true" />
        {label}
      </span>
    </li>
  );
}

export default function HealthCheckPage() {
  const [connection, setConnection] = useState(initialConnection);
  const [isChecking, setIsChecking] = useState(true);
  const activeRequest = useRef(null);

  const checkConnection = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 5000);

    setIsChecking(true);
    setConnection(initialConnection);

    try {
      const response = await fetch('/api/health', {
        signal: controller.signal,
        cache: 'no-store',
      });
      // A 503 still confirms Express is running. Read which dependency failed.
      const health = await response.json();
      if (
        ![200, 503].includes(response.status) ||
        !['ok', 'degraded'].includes(health.status) ||
        health.backend?.status !== 'running' ||
        !['connected', 'unavailable'].includes(health.database?.status)
      ) {
        throw new Error('Unexpected health response');
      }

      if (activeRequest.current !== controller) return;
      const databaseConnected = health.database.status === 'connected';
      const storageStatus = ['available', 'unavailable'].includes(health.storage?.status)
        ? health.storage.status : 'unknown';
      setConnection({
        backend: 'running',
        database: health.database.status,
        storage: storageStatus,
        checkedAt: new Date(),
        message: !databaseConnected
          ? 'The frontend can reach Express. Check the MongoDB connection settings, network access, and required database schema.'
          : storageStatus === 'unavailable'
            ? 'The backend and database are connected. Photo storage is unavailable; check the server storage configuration.'
            : storageStatus === 'available'
              ? 'The frontend, backend, database, and photo storage are working together.'
              : 'The frontend, backend, and database are connected. Photo storage has not been checked.',
      });
    } catch {
      if (activeRequest.current !== controller) return;
      setConnection({
        backend: 'unavailable',
        database: 'unknown',
        storage: 'unknown',
        checkedAt: new Date(),
        message: 'The backend did not return a health report. Make sure the Express server is running, then check again.',
      });
    } finally {
      window.clearTimeout(timeout);
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setIsChecking(false);
      }
    }
  }, []);

  useEffect(() => {
    checkConnection();
    return () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [checkConnection]);

  const backendLabel = {
    checking: 'Checking…',
    running: 'Reachable',
    unavailable: 'Unavailable',
  }[connection.backend];
  const databaseLabel = {
    checking: 'Checking…',
    connected: 'Connected',
    unavailable: 'Unavailable',
    unknown: 'Not checked',
  }[connection.database];
  const storageLabel = { checking: 'Checking…', available: 'Available', unavailable: 'Unavailable', unknown: 'Not checked' }[connection.storage];

  return (
    <main className="health-page mx-auto min-h-screen max-w-3xl px-5 py-10 sm:px-8 sm:py-16">
      <header className="brand">
        <span className="brand-mark" aria-hidden="true">✦</span>
        <span>Emotale</span>
        <a className="back-link" href="/">Back to card creator</a>
      </header>

      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">Emotale · Connection status</p>
        <h1 id="page-title">A little beginning.<br />A solid foundation.</h1>
        <p className="intro-copy">
          This page checks that the Emotale frontend,
          backend, database, and photo storage are available.
        </p>
      </section>

      <section className="connection-panel" aria-label="Application connection status" aria-busy={isChecking}>
        <div className="panel-heading">
          <h2>Connection check</h2>
          <span className="environment-label">Application status</span>
        </div>
        <ul className="status-list">
          <StatusRow
            name="React frontend"
            description="The page you are viewing, built with Vite."
            status="running"
            label="Running"
          />
          <StatusRow
            name="Express backend"
            description="Answers the frontend's health-check request."
            status={connection.backend}
            label={backendLabel}
          />
          <StatusRow
            name="MongoDB database"
            description="The backend checks its database connection."
            status={connection.database}
            label={databaseLabel}
          />
          <StatusRow
            name="Photo storage"
            description="The backend checks its private photo storage."
            status={connection.storage}
            label={storageLabel}
          />
        </ul>
        <div className="panel-footer">
          <div className="check-result" role="status" aria-live="polite" aria-atomic="true">
            <p>{connection.message}</p>
            {connection.checkedAt && (
              <p className="checked-time">
                Last checked at {connection.checkedAt.toLocaleTimeString()}
              </p>
            )}
          </div>
          <button type="button" onClick={checkConnection} disabled={isChecking}>
            {isChecking ? 'Checking…' : 'Check again'}
          </button>
        </div>
      </section>

      <footer className="page-footer">React + Vite <span aria-hidden="true">·</span> Express <span aria-hidden="true">·</span> MongoDB</footer>
    </main>
  );
}
