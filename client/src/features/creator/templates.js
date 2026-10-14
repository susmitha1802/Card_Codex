import { DESIGN_DEFAULTS } from '../../../../shared/designOptions.js';

function preset({ design, stickers = [], ...card }) {
  return {
    font: 'theme', textColor: null, fontSize: 'medium', alignment: 'center',
    ...card,
    design: { ...DESIGN_DEFAULTS, ...design },
    stickers,
  };
}

// Templates contain ordinary editable card choices, never recipient or unlock data.
export const CARD_TEMPLATES = [
  {
    id: 'birthday-celebration', name: 'Birthday Celebration',
    card: preset({
      occasion: 'birthday', title: 'Happy Birthday!', theme: 'birthday', font: 'rounded',
      message: "Here's to another year of wonderful little moments, big dreams, and all the things that make you smile. So glad you're in my life!",
      design: { layout: 'title', textWeight: 'medium', decorations: 'balloons' },
      stickers: [{ id: 'birthday', position: 'bottom-left', size: 'small', rotation: -15 }],
    }),
  },
  {
    id: 'wish-you-were-here', name: 'Wish You Were Here',
    card: preset({
      occasion: 'missing-you', title: 'Wish you were here', theme: 'dark', font: 'serif',
      message: "Some moments would be so much sweeter with you here. Until we can make more memories together, I'm sending you a little piece of my heart.",
      design: { background: 'midnight', layout: 'photo', photoLayout: 'stacked', lineSpacing: 'airy', decorations: 'stars' },
      stickers: [{ id: 'two-hearts', position: 'top-right', size: 'small', rotation: 15 }],
    }),
  },
  {
    id: 'im-sorry', name: "I'm Sorry",
    card: preset({
      occasion: 'sorry', title: "I'm sorry", theme: 'pastel', font: 'serif', alignment: 'left',
      message: "I've been thinking about what happened, and I want you to know that I'm sorry. You matter to me. I hope we can talk when you're ready, and I'll be here to listen.",
      design: { background: 'dawn', layout: 'letter', lineSpacing: 'airy', decorations: 'lines' },
      stickers: [{ id: 'hug', position: 'bottom-right', size: 'small', rotation: 0 }],
    }),
  },
  {
    id: 'thank-you', name: 'Thank You',
    card: preset({
      occasion: 'thank-you', title: 'A little thank you', theme: 'elegant', font: 'handwritten',
      message: "For your kindness, your time, and all the little things you do: thank you. They mean more to me than you know.",
      design: { background: 'cream', layout: 'centered', photoLayout: 'hero', lineSpacing: 'airy', decorations: 'petals' },
      stickers: [{ id: 'blossom', position: 'bottom-left', size: 'small', rotation: -15 }],
    }),
  },
  {
    id: 'you-did-it', name: 'You Did It!',
    card: preset({
      occasion: 'congratulations', title: 'You did it!', theme: 'celebration', font: 'rounded', fontSize: 'large',
      message: "Look at you shine! All that care and effort brought you here. I'm so proud of you, and I can't wait to see what you do next.",
      design: { layout: 'title', textWeight: 'bold', decorations: 'confetti' },
      stickers: [{ id: 'star', position: 'top-right', size: 'medium', rotation: 15 },
        { id: 'party', position: 'bottom-left', size: 'small', rotation: -15 }],
    }),
  },
  {
    id: 'just-for-you', name: 'Just For You',
    card: preset({
      occasion: 'love', title: 'Just for you', theme: 'romantic', font: 'serif',
      message: "Just a little reminder that you're loved, appreciated, and on my mind today. You make the ordinary moments feel special.",
      design: { layout: 'centered', decorations: 'hearts' },
      stickers: [{ id: 'sparkling-heart', position: 'top-right', size: 'small', rotation: 0 }],
    }),
  },
];
