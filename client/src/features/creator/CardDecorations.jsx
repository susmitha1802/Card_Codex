// These are small built-in shapes, never markup supplied by a sender. They are
// static in both preview and recipient views; the reveal has its own effects.
const decorationOptions = {
  hearts: { count: 4, symbol: '♥' },
  stars: { count: 4, symbol: '★' },
  sparkles: { count: 5, symbol: '✦' },
  petals: { count: 4, symbol: '' },
  balloons: { count: 3, symbol: '' },
  confetti: { count: 8, symbol: '' },
  lines: { count: 2, symbol: '' },
  dots: { count: 6, symbol: '' },
};

export default function CardDecorations({ decoration }) {
  if (!Object.hasOwn(decorationOptions, decoration)) return null;
  const { count, symbol } = decorationOptions[decoration];
  return (
    <div className="card-built-in-decorations" data-decoration={decoration} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span className="card-design-decoration" key={index}>{symbol}</span>
      ))}
    </div>
  );
}
