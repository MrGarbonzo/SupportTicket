const User = require('../models/user');
const Ticket = require('../models/ticket');
const logger = require('../utils/logger');
const ticketService = require('../services/ticketService');

// Ticket creation steps
const STEPS = {
  IDLE: 'idle',
  CATEGORY: 'category',
  DESCRIPTION: 'description',
  TRANSACTION_ID: 'transaction_id',
  CONFIRMATION: 'confirmation'
};

// Start ticket creation
const startTicketCreation = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    const isGroupChat = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
    
    // Find or create user
    let user = await User.findOne({ telegramId });
    if (!user) {
      user = new User({
        telegramId,
        username: ctx.from.username,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name
      });
      await user.save();
    }
    
    // If in group chat, redirect to DM
    if (isGroupChat) {
      await ctx.reply(`I'll help you create a support ticket. Please check your private messages to continue.`);
      
      // Start a private chat with the user
      try {
        // Update user state first to prepare for DM workflow
        // Use direct MongoDB update instead of modifying user object
        await User.updateOne(
          { telegramId },
          { $set: { state: { ticketStep: STEPS.CATEGORY, startedFromGroup: ctx.chat.id } } }
        );
        
        // Send message to user in private
        await ctx.telegram.sendMessage(
          telegramId, 
          'Let\'s create your support ticket. Please select the category that best describes your issue:',
          { reply_markup: ticketService.getCategoryKeyboard() }
        );
        
        logger.info(`Redirected user ${telegramId} to DM for ticket creation`);
      } catch (error) {
        logger.error(`Error sending DM to user: ${error.message}`);
        await ctx.reply('I couldn\'t send you a private message. Please make sure you\'ve started a conversation with me first by clicking on my username (@' + ctx.botInfo.username + ') and pressing the START button.');
      }
      return;
    }
    
    // If already in a private chat, proceed normally
    // Use direct MongoDB update instead of modifying user object
    await User.updateOne(
      { telegramId },
      { $set: { state: { ticketStep: STEPS.CATEGORY } } }
    );
    
    // Send category selection message
    await ctx.reply(
      'Please select the category that best describes your issue:',
      { reply_markup: ticketService.getCategoryKeyboard() }
    );
    
    logger.info(`User ${telegramId} started ticket creation process`);
  } catch (error) {
    logger.error(`Error starting ticket creation: ${error.message}`);
    await ctx.reply('Sorry, an error occurred while creating your ticket. Please try again later.');
  }
};

// Handle callback queries for ticket creation
const handleTicketCallback = async (ctx) => {
  try {
    const callbackData = ctx.callbackQuery.data;
    const telegramId = ctx.from.id;
    
    // Find user
    let user = await User.findOne({ telegramId });
    if (!user) {
      return ctx.answerCbQuery('User not found. Please start over.');
    }
    
    // Log current state before processing
    logger.info(`Handling callback for user ${telegramId}, current state: ${JSON.stringify(user.state)}`);
    
    // Handle cancel action
    if (callbackData === 'cancel') {
      // Use direct MongoDB update
      await User.updateOne(
        { telegramId },
        { $set: { 'state.ticketStep': STEPS.IDLE } }
      );
      
      await ctx.answerCbQuery('Ticket creation cancelled');
      return ctx.editMessageText('Ticket creation cancelled. Use /ticket to start again.');
    }
    
    // Handle back action
    if (callbackData === 'back') {
      return ticketService.handleBackAction(ctx, user);
    }
    
    // Handle skip action for transaction ID
    if (callbackData === 'skip' && user.state.ticketStep === STEPS.TRANSACTION_ID) {
      // Use direct MongoDB update
      await User.updateOne(
        { telegramId },
        { 
          $set: {
            'state.transactionId': 'N/A',
            'state.ticketStep': STEPS.CONFIRMATION
          }
        }
      );
      
      // Reload user to get updated state
      user = await User.findOne({ telegramId });
      
      logger.info(`User ${telegramId} skipped transaction ID, moving to confirmation`);
      return ticketService.showConfirmation(ctx, user);
    }
    
    // Handle category selection
    if (callbackData.startsWith('category:')) {
      const category = callbackData.split(':')[1];
      
      // IMPORTANT: Log the user state before update
      logger.info(`User ${telegramId} BEFORE update - state: ${JSON.stringify(user.state)}`);
      
      // Direct MongoDB update to ensure the state is correctly set
      await User.findOneAndUpdate(
        { telegramId },
        { 
          $set: {
            'state.category': category,
            'state.ticketStep': STEPS.DESCRIPTION 
          }
        },
        { new: true }
      );
      
      // Reload user after update to confirm changes took effect
      user = await User.findOne({ telegramId });
      
      // Log the user state after update
      logger.info(`User ${telegramId} AFTER update - state: ${JSON.stringify(user.state)}`);
      
      logger.info(`User ${telegramId} selected category: ${category}, new state: ${user.state.ticketStep}`);
      await ctx.answerCbQuery(`Selected: ${category}`);
      await ctx.editMessageText(
        `Category: ${category}\n\nPlease provide a detailed description of your issue (up to 500 characters):\n\nYou can type /cancel at any time to cancel ticket creation.`
      );
      return;
    }
    
    // Handle confirmation
    if (callbackData === 'confirm' && user.state.ticketStep === STEPS.CONFIRMATION) {
      logger.info(`User ${telegramId} confirmed ticket submission`);
      return ticketService.createTicket(ctx, user);
    }
    
    // If we get here, something unexpected happened
    logger.warn(`Unexpected callback data: ${callbackData} for user ${telegramId} in step ${user.state.ticketStep}`);
    await ctx.answerCbQuery('Invalid action');
    
  } catch (error) {
    logger.error(`Error handling ticket callback: ${error.message}`);
    await ctx.answerCbQuery('An error occurred');
    await ctx.reply('Sorry, an error occurred during ticket creation. Please try again with /ticket.');
  }
};

// Handle text messages for ticket creation
const handleTicketMessage = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    const messageText = ctx.message.text;
    
    // Check for cancel command
    if (messageText.toLowerCase() === '/cancel') {
      await User.updateOne({ telegramId }, { 'state.ticketStep': STEPS.IDLE });
      return ctx.reply('Ticket creation cancelled. Use /ticket to start again.');
    }
    
    // Find user
    let user = await User.findOne({ telegramId });
    if (!user || !user.state || !user.state.ticketStep || user.state.ticketStep === STEPS.IDLE) {
      logger.info(`Not in ticket creation process for user ${telegramId}`);
      return false; // Not in ticket creation process
    }
    
    logger.info(`Handling message for user ${telegramId}, step: ${user.state.ticketStep}`);
    
    // Handle description input
    if (user.state.ticketStep === STEPS.DESCRIPTION) {
      logger.info(`Processing description from user ${telegramId}`);
      
      if (messageText.length > 500) {
        logger.info(`Description too long from user ${telegramId}`);
        await ctx.reply('Your description is too long. Please keep it under 500 characters. Try again:');
        return true;
      }
      
      // Update user state using direct MongoDB update
      await User.updateOne(
        { telegramId },
        { 
          $set: {
            'state.description': messageText,
            'state.ticketStep': STEPS.TRANSACTION_ID
          }
        }
      );
      
      // Reload user to get updated state
      user = await User.findOne({ telegramId });
      
      logger.info(`User ${telegramId} provided description, moving to transaction ID step`);
      
      await ctx.reply(
        `Category: ${user.state.category}\nDescription: ${messageText}\n\nPlease provide any TX hashes related to your issue (one per line). You can provide multiple TX hashes if needed:`,
        { reply_markup: ticketService.getTransactionIdKeyboard() }
      );
      return true;
    }
    
    // Handle transaction ID input
    if (user.state.ticketStep === STEPS.TRANSACTION_ID) {
      logger.info(`Processing transaction ID from user ${telegramId}`);
      
      // Update user state using direct MongoDB update
      await User.updateOne(
        { telegramId },
        { 
          $set: {
            'state.transactionId': messageText,
            'state.ticketStep': STEPS.CONFIRMATION
          }
        }
      );
      
      // Reload user to get updated state
      user = await User.findOne({ telegramId });
      
      logger.info(`User ${telegramId} provided transaction ID, moving to confirmation`);
      
      return ticketService.showConfirmation(ctx, user);
    }
    
    logger.info(`Message not handled in ticket flow for user ${telegramId}`);
    return false;
  } catch (error) {
    logger.error(`Error handling ticket message: ${error.message}`);
    await ctx.reply('Sorry, an error occurred during ticket creation. Please try again with /ticket.');
    return false;
  }
};

// Cancel current ticket creation
const cancelTicketCreation = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    
    await User.updateOne({ telegramId }, { 'state.ticketStep': STEPS.IDLE });
    return ctx.reply('Current operation cancelled.');
  } catch (error) {
    logger.error(`Error cancelling operation: ${error.message}`);
  }
};

module.exports = {
  startTicketCreation,
  handleTicketCallback,
  handleTicketMessage,
  cancelTicketCreation,
  STEPS
};