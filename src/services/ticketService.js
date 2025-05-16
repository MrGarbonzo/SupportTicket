const User = require('../models/user');
const Ticket = require('../models/ticket');
const logger = require('../utils/logger');

// Ticket categories
const CATEGORIES = ['General', 'Bridging/IBC', 'Staking', 'Viewing Keys', 'Other'];

// Helper function to create inline keyboard for categories
const getCategoryKeyboard = () => {
  const keyboard = CATEGORIES.map(category => [{
    text: category,
    callback_data: `category:${category}`
  }]);
  
  // Add cancel button
  keyboard.push([{ text: 'Cancel', callback_data: 'cancel' }]);
  
  return {
    inline_keyboard: keyboard
  };
};

// Helper function to create transaction ID keyboard - renamed for TX hashes
const getTransactionIdKeyboard = () => {
  return {
    inline_keyboard: [
      [{ text: 'Skip', callback_data: 'skip' }],
      [
        { text: '« Back', callback_data: 'back' },
        { text: 'Cancel', callback_data: 'cancel' }
      ]
    ]
  };
};

// Helper function to create confirmation keyboard
const getConfirmationKeyboard = () => {
  return {
    inline_keyboard: [
      [
        { text: 'Confirm', callback_data: 'confirm' },
        { text: 'Cancel', callback_data: 'cancel' }
      ],
      [{ text: '« Edit Details', callback_data: 'back' }]
    ]
  };
};

// Helper function to show confirmation screen
const showConfirmation = async (ctx, user) => {
  try {
    const { category, description, transactionId } = user.state;
    
    const confirmationMessage = 
      `Please confirm your ticket details:\n\n` +
      `Category: ${category}\n` +
      `Description: ${description}\n` +
      `TX Hash(es): ${transactionId || 'N/A'}\n\n` +
      `Press "Confirm" to submit or "Edit Details" to make changes.`;
    
    // Use editMessageText if we're responding to a callback, otherwise send new message
    if (ctx.callbackQuery) {
      await ctx.editMessageText(confirmationMessage, {
        reply_markup: getConfirmationKeyboard()
      });
    } else {
      await ctx.reply(confirmationMessage, {
        reply_markup: getConfirmationKeyboard()
      });
    }
    
    return true;
  } catch (error) {
    logger.error(`Error showing confirmation: ${error.message}`);
    await ctx.reply('Sorry, an error occurred. Please try again with /ticket.');
    return false;
  }
};

// Helper function to handle back button actions
const handleBackAction = async (ctx, user) => {
  try {
    // Import this dynamically to avoid circular dependency
    const { STEPS } = require('../controllers/ticketController');
    
    const currentStep = user.state.ticketStep;
    
    switch (currentStep) {
      case STEPS.TRANSACTION_ID:
        await User.updateOne(
          { telegramId: user.telegramId },
          { $set: { 'state.ticketStep': STEPS.DESCRIPTION } }
        );
        
        // Reload user to get updated state
        user = await User.findOne({ telegramId: user.telegramId });
        
        await ctx.answerCbQuery('Going back to description');
        await ctx.editMessageText(
          `Category: ${user.state.category}\n\nPlease provide a detailed description of your issue (up to 500 characters):\n\nYou can type /cancel at any time to cancel ticket creation.`
        );
        break;
        
      case STEPS.CONFIRMATION:
        await User.updateOne(
          { telegramId: user.telegramId },
          { $set: { 'state.ticketStep': STEPS.TRANSACTION_ID } }
        );
        
        // Reload user to get updated state
        user = await User.findOne({ telegramId: user.telegramId });
        
        await ctx.answerCbQuery('Going back to TX hashes');
        await ctx.editMessageText(
          `Category: ${user.state.category}\n\nPlease provide any TX hashes related to your issue (one per line). You can provide multiple TX hashes if needed:`,
          { reply_markup: getTransactionIdKeyboard() }
        );
        break;
        
      default:
        await ctx.answerCbQuery('Cannot go back further');
    }
    
    return true;
  } catch (error) {
    logger.error(`Error handling back action: ${error.message}`);
    await ctx.answerCbQuery('An error occurred');
    return false;
  }
};

// Helper function to create the actual ticket
const createTicket = async (ctx, user) => {
  try {
    // Generate a unique ticket ID with blockchain theme
    const timestamp = Date.now();
    const randomPart = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    const ticketId = `TKT-${timestamp.toString(16)}-${randomPart}`;
    
    // Create ticket in database
    const newTicket = new Ticket({
      userId: user.telegramId,
      username: user.username || `user_${user.telegramId}`,
      category: user.state.category,
      description: user.state.description,
      status: 'open',
      priority: 'medium', // Default priority since we removed the selection
      messages: [{
        sender: user.username || `user_${user.telegramId}`,
        text: user.state.description
      }]
    });
    
    // Add TX hashes as first comment if provided
    if (user.state.transactionId && user.state.transactionId !== 'N/A') {
      newTicket.messages.push({
        sender: user.username || `user_${user.telegramId}`,
        text: `TX Hash(es): ${user.state.transactionId}`
      });
    }
    
    await newTicket.save();
    
    // Import STEPS to avoid circular dependency
    const { STEPS } = require('../controllers/ticketController');
    
    // Update user state using direct MongoDB update
    await User.updateOne(
      { telegramId: user.telegramId },
      { 
        $set: { 
          'state.ticketStep': STEPS.IDLE,
          activeTicket: newTicket._id
        }
      }
    );
    
    // Send confirmation message
    await ctx.answerCbQuery('Ticket created successfully!');
    await ctx.editMessageText(
      `✅ Ticket created successfully!\n\n` +
      `Ticket ID: ${ticketId}\n` +
      `Status: Open\n\n` +
      `We'll notify you when a support agent responds to your ticket. Thank you for your patience.`
    );
    
    logger.info(`User ${user.telegramId} created ticket ${newTicket._id}`);
    
    // Notify support staff about new ticket
    await notifySupportTeam(ctx, newTicket, user);
    
    return true;
    
  } catch (error) {
    logger.error(`Error creating ticket: ${error.message}`);
    await ctx.answerCbQuery('Failed to create ticket');
    await ctx.editMessageText('Sorry, an error occurred while creating your ticket. Please try again later.');
    return false;
  }
};

// Function to notify support team about new tickets
const notifySupportTeam = async (ctx, ticket, user) => {
  try {
    // Get support channel ID from .env
    const supportChannelId = process.env.SUPPORT_CHANNEL_ID;
    
    if (!supportChannelId) {
      logger.warn('Support channel ID not configured, skipping notification');
      return;
    }
    
    // Create truncated description for notification
    const descriptionPreview = ticket.description.length > 100 
      ? ticket.description.substring(0, 97) + '...' 
      : ticket.description;
      
    // Send notification to support channel
    const sentMessage = await ctx.telegram.sendMessage(
      supportChannelId,
      `🎫 NEW TICKET #${ticket._id}\n\n` +
      `From: ${user.username ? '@' + user.username : user.telegramId}\n` +
      `Category: ${ticket.category}\n` +
      `Description: ${descriptionPreview}\n\n` +
      `This ticket is awaiting assignment.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '👨‍💻 Claim Ticket', callback_data: `claim:${ticket._id}` }]
          ]
        }
      }
    );
    
    // Store the message ID for later updates
    ticket.supportChannelMessageId = sentMessage.message_id;
    await ticket.save();
    
    logger.info(`Support team notified about ticket ${ticket._id}`);
  } catch (error) {
    logger.error(`Error notifying support team: ${error.message}`);
  }
};

// Function to handle ticket claiming by support staff
const claimTicket = async (ctx, ticketId, agentId) => {
  try {
    // Find the ticket and the agent
    const ticket = await Ticket.findById(ticketId);
    const agent = await User.findOne({ telegramId: agentId });
    
    if (!ticket) {
      return ctx.answerCbQuery('Ticket not found');
    }
    
    if (!agent) {
      return ctx.answerCbQuery('Agent not found');
    }
    
    // Check if agent is authorized as staff
    if (!agent.isStaff) {
      return ctx.answerCbQuery('You are not authorized to claim tickets');
    }
    
    // Check if ticket is already assigned
    if (ticket.assignedTo) {
      return ctx.answerCbQuery('This ticket is already assigned');
    }
    
    // Assign ticket to agent
    ticket.assignedTo = agent.username || `agent_${agent.telegramId}`;
    ticket.status = 'in-progress';
    await ticket.save();
    
    // Update the message in the support channel
    await ctx.editMessageText(
      `🎫 TICKET #${ticket._id} [IN PROGRESS]\n\n` +
      `From: ${ticket.username}\n` +
      `Category: ${ticket.category}\n` +
      `Description: ${ticket.description.substring(0, 100)}${ticket.description.length > 100 ? '...' : ''}\n\n` +
      `Assigned to: @${agent.username || agent.telegramId}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '💬 View Conversation', callback_data: `view:${ticket._id}` }]
          ]
        }
      }
    );
    
    // Notify the user that their ticket has been claimed
    try {
      await ctx.telegram.sendMessage(
        ticket.userId,
        `🎫 Your ticket has been assigned to a support agent: @${agent.username || agent.telegramId}\n\n` +
        `They will be helping you with your issue. Please wait for their message.`
      );
    } catch (error) {
      logger.error(`Error notifying user about ticket claim: ${error.message}`);
    }
    
    // Add agent to the conversation
    // This is where you would implement the agent joining the DM or creating a group chat
    await addAgentToConversation(ctx, ticket, agent);
    
    await ctx.answerCbQuery('Ticket claimed successfully!');
    logger.info(`Ticket ${ticketId} claimed by agent ${agentId}`);
    
    return true;
  } catch (error) {
    logger.error(`Error claiming ticket: ${error.message}`);
    await ctx.answerCbQuery('Error claiming ticket');
    return false;
  }
};

// Function to add agent to the conversation with the user
const addAgentToConversation = async (ctx, ticket, agent) => {
  try {
    // Send a message to the agent with instructions
    await ctx.telegram.sendMessage(
      agent.telegramId,
      `🎫 You have claimed ticket #${ticket._id}\n\n` +
      `User: ${ticket.username}\n` +
      `Category: ${ticket.category}\n` +
      `Description: ${ticket.description}\n\n` +
      `To respond to the user, use the /reply command followed by your message.\n` +
      `Example: /reply Hello, I'll be assisting you today.`
    );
    
    // Add a welcome message from the agent to the ticket
    ticket.messages.push({
      sender: agent.username || `agent_${agent.telegramId}`,
      text: `Agent ${agent.username || agent.telegramId} has been assigned to this ticket and will assist you shortly.`,
      timestamp: Date.now()
    });
    
    await ticket.save();
    
    logger.info(`Agent ${agent.telegramId} added to conversation for ticket ${ticket._id}`);
  } catch (error) {
    logger.error(`Error adding agent to conversation: ${error.message}`);
  }
};

module.exports = {
  CATEGORIES,
  getCategoryKeyboard,
  getTransactionIdKeyboard,
  getConfirmationKeyboard,
  showConfirmation,
  handleBackAction,
  createTicket,
  notifySupportTeam,
  claimTicket,
  addAgentToConversation
};