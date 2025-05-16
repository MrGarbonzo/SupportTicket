const express = require('express');
const { Telegraf, session } = require('telegraf');
const dotenv = require('dotenv');
const logger = require('./utils/logger');
const connectDB = require('./config/db');
const User = require('./models/user'); // Add this import
const ticketController = require('./controllers/ticketController');
const supportController = require('./controllers/supportController');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Telegram bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// Use session middleware
bot.use(session());

// Configure Express middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set up basic bot commands
bot.start((ctx) => ctx.reply('Welcome to the Support Bot! Type /help to see available commands.'));
bot.help((ctx) => {
  // Different help message for support staff
  if (ctx.session && ctx.session.isStaff) {
    return ctx.reply(
      'Support Staff Commands:\n' +
      '/ticket - Create a new support ticket\n' +
      '/mytickets - View tickets assigned to you\n' +
      '/reply [message] - Reply to a user ticket\n' +
      '/resolve - Mark a ticket as resolved\n' +
      '/cancel - Cancel current operation'
    );
  }
  
  // Regular user help message
  return ctx.reply(
    'Available commands:\n' +
    '/start - Start the bot\n' +
    '/ticket - Create a new support ticket\n' +
    '/myticket - View your active ticket\n' +
    '/cancel - Cancel current operation'
  );
});

// Set up ticket command
bot.command('ticket', ticketController.startTicketCreation);
bot.command('cancel', ticketController.cancelTicketCreation);

// Set up support team commands
bot.command('mytickets', supportController.viewAssignedTickets);
bot.command('reply', supportController.replyToTicket);
bot.command('resolve', supportController.resolveTicket);
bot.command('myticket', supportController.viewUserTicket);

// Handle callback queries
bot.on('callback_query', async (ctx) => {
  const callbackData = ctx.callbackQuery.data;
  
  // Handle ticket creation callbacks
  if (callbackData.startsWith('category:') || 
      callbackData === 'cancel' || 
      callbackData === 'back' || 
      callbackData === 'skip' || 
      callbackData === 'confirm') {
    return ticketController.handleTicketCallback(ctx);
  }
  
  // Handle ticket claiming callbacks
  if (callbackData.startsWith('claim:')) {
    const ticketId = callbackData.split(':')[1];
    return supportController.claimTicket(ctx, ticketId);
  }
  
  // Handle ticket viewing callbacks
  if (callbackData.startsWith('view:')) {
    const ticketId = callbackData.split(':')[1];
    return supportController.viewTicket(ctx, ticketId);
  }
  
  // Handle resolve button callbacks
  if (callbackData.startsWith('resolve:')) {
    const ticketId = callbackData.split(':')[1];
    return supportController.resolveTicketCallback(ctx, ticketId);
  }
  
  // Handle reply button callbacks
  if (callbackData.startsWith('reply:')) {
    const ticketId = callbackData.split(':')[1];
    return supportController.setReplyContext(ctx, ticketId);
  }
  
  // Handle user canceling their own ticket
  if (callbackData.startsWith('cancel_ticket:')) {
    const ticketId = callbackData.split(':')[1];
    return supportController.cancelUserTicket(ctx, ticketId);
  }
  
  // If we reach here, it's an unhandled callback
  logger.warn(`Unhandled callback: ${callbackData}`);
  return ctx.answerCbQuery('This action is not currently supported.');
});

// Handle text messages - CRUCIAL FIX: Only call next() once
bot.on('text', async (ctx) => {
  try {
    // Try ticket handler first
    const handled = await ticketController.handleTicketMessage(ctx);
    
    // If ticket handler processed the message, we're done
    if (handled) {
      return;
    }
    
    // Try support handler if the message wasn't for ticket creation
    const supportHandled = await supportController.handleSupportMessage(ctx);
    
    // If support handler processed the message, we're done
    if (supportHandled) {
      return;
    }
    
    // If we get here, neither handler processed the message
    logger.info(`Received unhandled message from ${ctx.from.id}`);
    
    // Check if user is in a ticket creation flow
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (!user || !user.state || user.state.ticketStep === 'idle' || !user.state.ticketStep) {
      await ctx.reply("I don't understand that command. Type /help to see available commands.");
    }
  } catch (error) {
    logger.error(`Error processing message: ${error.message}`);
    await ctx.reply("Sorry, I encountered an error processing your message. Please try again.");
  }
});

// Set up root route
app.get('/', (req, res) => {
  res.send('Telegram Support Bot is running!');
});

// Start Express server
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  connectDB();
  
  // Start bot using polling for development
  bot.launch().then(() => {
    logger.info('Bot started successfully');
  }).catch((err) => {
    logger.error(`Error starting bot: ${err.message}`, { stack: err.stack });
  });
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));