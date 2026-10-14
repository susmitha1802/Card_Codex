import CardCreator from './features/creator/CardCreator.jsx';
import HealthCheckPage from './features/health/HealthCheckPage.jsx';
import RecipientCardPage from './features/recipient/RecipientCardPage.jsx';

export default function App() {
  // Keep the small pathname-based routing approach from the earlier phases.
  const path = window.location.pathname.replace(/\/$/, '');
  if (path === '/health') return <HealthCheckPage />;
  const recipientRoute = path.match(/^\/card\/([^/]+)$/);
  if (recipientRoute) return <RecipientCardPage shareToken={recipientRoute[1]} />;
  if (path === '/card' || path.startsWith('/card/')) {
    return <RecipientCardPage shareToken="invalid" />;
  }
  return <CardCreator />;
}
