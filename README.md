# Telegram Support Bot
# Telegram Support Bot

A comprehensive Telegram bot for managing support tickets with AI integration.

## Features

- **Multi-step Ticket Creation**: Guide users through creating detailed support tickets
- **Category Selection**: Organize tickets by predefined categories
- **Priority Levels**: Set urgency levels for proper handling
- **Transaction ID Support**: Include blockchain transaction IDs or wallet addresses
- **Back/Cancel Options**: Allow users to modify or cancel their tickets during creation
- **Preview Before Submission**: Show users a summary of their ticket before finalizing

## Project Structure

```
telegram-support-bot/
├── src/
│   ├── config/                # Configuration files
│   │   └── db.js              # Database configuration
│   ├── controllers/           # Route and bot command controllers
│   │   └── ticketController.js  # Ticket creation workflow implementation
│   ├── models/                # MongoDB models
│   │   ├── user.js            # User model
│   │   └── ticket.js          # Ticket model
│   ├── services/              # Business logic services
│   │   └── ticketService.js   # Ticket-related operations
│   ├── utils/                 # Utility functions and helpers
│   │   └── logger.js          # Logging configuration
│   └── index.js               # Main entry point for the application
├── tests/                     # Test files
└── .env                       # Environment variables
```

## Setup Instructions

### Prerequisites

- Node.js 14.x or higher
- MongoDB 4.x or higher
- A Telegram bot token from BotFather

### Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/telegram-support-bot.git
   cd telegram-support-bot
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file based on `.env.example`:
   ```
   cp .env.example .env
   ```

4. Edit the `.env` file with your specific configuration:
   ```
   BOT_TOKEN=your_telegram_bot_token_here
   MONGODB_URI=mongodb://localhost:27017/support-bot
   PORT=3000
   ```

5. Start the application:
   ```
   npm start
   ```

   For development with auto-reload:
   ```
   npm run dev
   ```

## Testing the Bot

1. Start a conversation with your bot on Telegram
2. Send the `/start` command to initiate the bot
3. Send `/help` to see available commands
4. Test the ticket creation process:
   - Send `/ticket` to begin the ticket creation flow
   - Select a category from the provided options
   - Enter a detailed description of your issue
   - Select a priority level
   - Provide a transaction ID (optional)
   - Review your ticket and confirm submission

### Testing Edge Cases

- Test cancellation at different stages using the "Cancel" button or `/cancel` command
- Test the "Back" functionality to modify previous inputs
- Test skipping optional fields
- Test input validation (e.g., description length limits)

## Docker Support

You can run the bot in a Docker container for easier deployment:

```
docker build -t telegram-support-bot .
docker run -d --env-file .env telegram-support-bot
```

## Future Enhancements

- Support staff interface for ticket management
- Admin dashboard for analytics
- AI integration for automated responses
- Knowledge base integration
- Response templates

## License

[MIT](LICENSE)
