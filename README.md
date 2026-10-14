# Emotale 💌

### Little messages. Lasting feelings.

**Emotale** is a personalized digital greeting card creator that helps you turn your feelings into beautiful, shareable cards. Whether it's a birthday, anniversary, heartfelt apology, or a simple message to someone special, Emotale makes every message feel personal.

Create a card, customize its appearance, and share it through a unique link. Recipients can open their cards through a simple, animated envelope reveal, with optional secret-code protection for a more private experience.

---

## ✨ Features

- **Personalized cards** — Choose from multiple occasions, themes, and editable templates.
- **Live preview** — See your card update as you write and customize it.
- **Flexible design controls** — Customize fonts, text size, alignment, colors, backgrounds, layouts, and decorations.
- **Photo memories** — Add up to four photos, arrange them, and include built-in stickers.
- **Private card protection** — Optionally protect a card with a secret code and hints.
- **Unique shareable links** — Create a dedicated link for each card.
- **Beautiful recipient experience** — Reveal cards with a branded envelope animation.
- **Easy sharing** — Copy links or share through WhatsApp, email, X, or your device's native sharing menu.
- **Privacy-conscious previews** — Use generic social link previews that do not expose card messages or protected content.
- **Responsive interface** — Create and view cards on desktop and mobile screens.
- **Accessibility support** — Keyboard-accessible controls, visible focus states, and reduced-motion support.

## 🛠️ Tech Stack

| Layer | Technologies |
| --- | --- |
| Frontend | React, Vite, JavaScript |
| Backend | Node.js, Express.js |
| Database | MongoDB, MongoDB Atlas |
| Card rendering | React components and shared design utilities |
| Security | Server-side validation, cryptographic share tokens, salted code hashing, protected photo access |
| Testing | Automated backend tests, browser checks, JavaScript syntax checks, production builds |

## 🚀 Getting Started

Follow these steps to run Emotale locally.

### Prerequisites

Install the following:

- [Node.js and npm](https://nodejs.org/)
- [MongoDB](https://www.mongodb.com/) — a local MongoDB instance or a MongoDB Atlas cluster
- [Git](https://git-scm.com/)

### 1. Clone the repository

```bash
git clone https://github.com/susmitha1802/Card_Codex.git
cd Card_Codex
```

### 2. Install dependencies

```bash
npm ci --include=optional
```

### 3. Configure environment variables

Create your local environment file by copying the example configuration.

In PowerShell:

```powershell
Copy-Item server/.env.example server/.env
```

Open `server/.env` and configure the database settings:

```dotenv
MONGODB_URI=your_mongodb_connection_string
MONGODB_DB_NAME=card_codex
```

Use your actual local MongoDB or MongoDB Atlas connection string. Keep your real credentials in the local `.env` file; never commit them to GitHub.

Check the example configuration and `DEPLOYMENT.md` for any additional settings required by your environment.

### 4. Start the application

```bash
npm run dev
```

Open the frontend in your browser:

**http://127.0.0.1:5173**

The backend runs alongside the frontend during development. Check the terminal output if either service fails to start.

### 5. Run tests and build

Run the available automated tests:

```bash
npm test
```

Create a production frontend build:

```bash
npm run build
```

For database setup and deployment requirements, see [`DEPLOYMENT.md`](DEPLOYMENT.md).

## 💌 How It Works

1. **Create** — Choose an occasion and write your personal message.
2. **Customize** — Select a theme, adjust the design, and optionally add photos or stickers.
3. **Preview** — See the card update while you edit.
4. **Protect (optional)** — Add a secret code and hints if you want an extra layer of privacy.
5. **Save** — Click **Create Card 💌** to save the card to MongoDB.
6. **Share** — Copy the generated link or use one of the available sharing options.
7. **Reveal** — The recipient opens the link and experiences the card reveal. Protected cards require the correct code before their contents are shown.

## 🔐 Privacy and Security

Emotale is designed with privacy-conscious sharing in mind.

- Card data is validated by the backend before it is saved.
- Share links use cryptographically generated tokens rather than sequential database IDs.
- Secret codes are stored as salted cryptographic hashes, not as plaintext.
- Protected card contents are withheld until the code is verified on the server.
- Private photos are served through authorized backend routes rather than exposed as public static files.
- Social previews use generic content instead of personal messages, names, secret codes, or private photo URLs.
- Environment files and local private media are excluded from version control.

**Important:** A shareable link is still a way to access a card. Only share it with people you trust, and share a protected card's secret code separately from its link.

## 📁 Project Structure

```text
Card_Codex/
├── client/                 # React + Vite frontend
│   ├── public/              # Public assets and branding
│   └── src/                 # UI components and application code
├── server/                 # Express backend
│   ├── db/                  # Database setup and migrations
│   └── src/                 # API, validation and server logic
├── shared/                 # Shared card options and design utilities
├── tests/                  # Automated tests
├── DEPLOYMENT.md           # Deployment and database guide
├── package.json            # Project scripts and dependencies
└── README.md               # Project documentation
```

## ⚙️ Configuration and Deployment

For database provisioning, schema setup, production environment variables, storage requirements, HTTPS, health checks, and deployment preparation, follow [`DEPLOYMENT.md`](DEPLOYMENT.md).

The project includes production configuration and readiness checks, but a successful local build does not guarantee that the application is ready for public hosting. Before deployment, verify MongoDB connectivity, initialize the required database schema, and configure durable photo storage and production secrets.

## 🧪 Testing

The project includes automated backend tests and additional checks for key application behavior, including card creation, protected access, photo handling, responsive layouts, and production builds.

Run the test suite and build commands above before submitting changes.

## 🗺️ Roadmap

Potential next steps for Emotale include:

- Complete production deployment and verify the live application.
- Configure durable cloud storage for uploaded photos.
- Test the complete user journey using a public HTTPS URL.
- Continue improving the card creation and sharing experience.

## 🤝 Contributing

Suggestions and improvements are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Make your changes and test them.
4. Open a pull request describing the improvement.

Please do not include passwords, database credentials, private photos, or other sensitive data in commits or issue reports.

## 📄 License

A license has not yet been specified. Please check the repository for licensing information before reusing or distributing this project.

---

<p align="center">

**Emotale 💌**

*Little messages. Lasting feelings.*

Made to make meaningful moments a little more special.

</p>
