const User = require('../models/user');
const Ticket = require('../models/ticket');
const logger = require('../utils/logger');
const ticketService = require('../services/ticketService');

// View tickets assigned to support agent
const viewAssignedTickets = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    
    // Find the support agent
    const agent = await User.findOne({ telegramId });
    if (!agent) {
      return ctx.reply('User not found. Please start a conversation with /start first.');
    }
    
    // Check if user is authorized as support staff
    if (!agent.isStaff) {
      return ctx.reply('You are not authorized to view assigned tickets.');
    }
    
    // Get agent's username or ID string
    const agentIdentifier = agent.username || `agent_${agent.telegramId}`;
    
    // Find all tickets assigned to this agent
    const tickets = await Ticket.find({ 
      assignedTo: agentIdentifier,
      status: { $in: ['open', 'in-progress'] }
    }).sort({ createdAt: -1 });
    
    if (tickets.length === 0) {
      return ctx.reply('You don\'t have any active tickets assigned to you.');
    }
    
    // Format tickets list
    let message = '🎫 Your assigned tickets:\n\n';
    
    tickets.forEach((ticket, index) => {
      // Format date
      const date = new Date(ticket.createdAt).toLocaleString();
      
      // Truncate description
      const shortDesc = ticket.description.length > 30 
        ? ticket.description.substring(0, 27) + '...' 
        : ticket.description;
        
      message += `${index + 1}. #${ticket._id}\n` +
                 `   From: ${ticket.username}\n` +
                 `   Category: ${ticket.category}\n` +
                 `   Status: ${ticket.status}\n` +
                 `   Created: ${date}\n` +
                 `   Description: ${shortDesc}\n\n`;
    });
    
    message += 'To view a specific ticket, use the buttons below:';
    
    // Create inline keyboard with ticket IDs
    const keyboard = {
      inline_keyboard: tickets.map(ticket => [{
        text: `Ticket #${ticket._id}`,
        callback_data: `view:${ticket._id}`
      }])
    };
    
    return ctx.reply(message, { reply_markup: keyboard });
    
  } catch (error) {
    logger.error(`Error viewing assigned tickets: ${error.message}`);
    return ctx.reply('An error occurred while retrieving your assigned tickets.');
  }
};

// Claim a ticket
const claimTicket = async (ctx, ticketId) => {
  try {
    const telegramId = ctx.from.id;
    
    // Find the support agent
    const agent = await User.findOne({ telegramId });
    if (!agent) {
      return ctx.answerCbQuery('User not found. Please start a conversation with /start first.');
    }
    
    // Check if user is authorized as support staff
    if (!agent.isStaff) {
      return ctx.answerCbQuery('You are not authorized to claim tickets.');
    }
    
    // Use the ticketService to claim the ticket
    return ticketService.claimTicket(ctx, ticketId, telegramId);
    
  } catch (error) {
    logger.error(`Error claiming ticket: ${error.message}`);
    return ctx.answerCbQuery('An error occurred while claiming the ticket.');
  }
};

// View specific ticket details
const viewTicket = async (ctx, ticketId) => {
  try {
    const telegramId = ctx.from.id;
    
    // Find the support agent
    const agent = await User.findOne({ telegramId });
    if (!agent) {
      return ctx.answerCbQuery('User not found. Please start a conversation with /start first.');
    }
    
    // Check if user is authorized as support staff
    if (!agent.isStaff) {
      return ctx.answerCbQuery('You are not authorized to view ticket details.');
    }
    
    // Find the ticket
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return ctx.answerCbQuery('Ticket not found.');
    }
    
    // Format the ticket details
    const date = new Date(ticket.createdAt).toLocaleString();
    const lastUpdated = new Date(ticket.updatedAt).toLocaleString();
    
    let message = `🎫 Ticket #${ticket._id}\n\n` +
                 `From: ${ticket.username}\n` +
                 `Category: ${ticket.category}\n` +
                 `Status: ${ticket.status}\n` +
                 `Priority: ${ticket.priority}\n` +
                 `Created: ${date}\n` +
                 `Last Updated: ${lastUpdated}\n` +
                 `Assigned To: ${ticket.assignedTo || 'Unassigned'}\n\n` +
                 `Description:\n${ticket.description}\n\n` +
                 `Conversation History:\n`;
    
    // Add conversation history
    if (ticket.messages && ticket.messages.length > 0) {
      ticket.messages.forEach((msg, index) => {
        const msgTime = new Date(msg.timestamp).toLocaleString();
        message += `\n${msg.sender}: ${msg.text}\n[${msgTime}]\n`;
      });
    } else {
      message += '\nNo messages yet.\n';
    }
    
    // Create inline keyboard for actions
    const keyboard = {
      inline_keyboard: [
        [
          { text: '💬 Reply', callback_data: `reply:${ticket._id}` },
          { text: '✅ Resolve', callback_data: `resolve:${ticket._id}` }
        ]
      ]
    };
    
    // If this is a callback_query, edit the message, otherwise send a new one
    if (ctx.callbackQuery) {
      return ctx.editMessageText(message, { reply_markup: keyboard });
    } else {
      return ctx.reply(message, { reply_markup: keyboard });
    }
    
  } catch (error) {
    logger.error(`Error viewing ticket: ${error.message}`);
    if (ctx.callbackQuery) {
      return ctx.answerCbQuery('An error occurred while retrieving ticket details.');
    } else {
      return ctx.reply('An error occurred while retrieving ticket details.');
    }
  }
};

// View user's active ticket
const viewUserTicket = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    
    // Find the user
    const user = await User.findOne({ telegramId });
    if (!user) {
      return ctx.reply('User not found. Please start a conversation with /start first.');
    }
    
    // Find user's active ticket
    if (!user.activeTicket) {
      return ctx.reply('You don\'t have any active tickets. Use /ticket to create a new one.');
    }
    
    const ticket = await Ticket.findById(user.activeTicket);
    if (!ticket) {
      // Clean up if the ticket was deleted
      user.activeTicket = null;
      await user.save();
      return ctx.reply('No active ticket found. Use /ticket to create a new one.');
    }
    
    // Format the ticket details
    const date = new Date(ticket.createdAt).toLocaleString();
    const lastUpdated = new Date(ticket.updatedAt).toLocaleString();
    
    let message = `🎫 Your ticket #${ticket._id}\n\n` +
                 `Category: ${ticket.category}\n` +
                 `Status: ${ticket.status}\n` +
                 `Priority: ${ticket.priority}\n` +
                 `Created: ${date}\n` +
                 `Last Updated: ${lastUpdated}\n` +
                 `Assigned To: ${ticket.assignedTo || 'Waiting for assignment'}\n\n` +
                 `Description:\n${ticket.description}\n\n` +
                 `Conversation History:\n`;
    
    // Add conversation history
    if (ticket.messages && ticket.messages.length > 0) {
      ticket.messages.forEach((msg, index) => {
        const msgTime = new Date(msg.timestamp).toLocaleString();
        message += `\n${msg.sender}: ${msg.text}\n[${msgTime}]\n`;
      });
    } else {
      message += '\nNo messages yet.\n';
    }
    
    // Only show cancel button if ticket is open
    const keyboard = ticket.status === 'resolved' || ticket.status === 'closed' 
      ? undefined 
      : {
          inline_keyboard: [
            [{ text: '❌ Cancel Ticket', callback_data: `cancel_ticket:${ticket._id}` }]
          ]
        };
    
    return ctx.reply(message, keyboard ? { reply_markup: keyboard } : {});
    
  } catch (error) {
    logger.error(`Error viewing user ticket: ${error.message}`);
    return ctx.reply('An error occurred while retrieving your ticket details.');
  }
};

// Reply to a ticket
const replyToTicket = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    const messageText = ctx.message.text;
    
    // Extract the reply message (everything after "/reply ")
    const match = messageText.match(/^\/reply\s+(.+)$/s);
    if (!match) {
      return ctx.reply('Please provide a message to reply with. Format: /reply Your message here');
    }
    
    const replyMessage = match[1].trim();
    if (!replyMessage) {
      return ctx.reply('Please provide a message to reply with. Format: /reply Your message here');
    }
    
    // Find the support agent
    const agent = await User.findOne({ telegramId });
    if (!agent) {
      return ctx.reply('User not found. Please start a conversation with /start first.');
    }
    
    // Check if user is authorized as support staff
    if (!agent.isStaff) {
      return ctx.reply('You are not authorized to reply to tickets.');
    }
    
    // Get agent's active conversation context
    if (!agent.state || !agent.state.activeTicket) {
      return ctx.reply('No active ticket selected. Use /mytickets to select a ticket to reply to.');
    }
    
    const ticketId = agent.state.activeTicket;
    
    // Find the ticket
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      // Clear the active ticket reference
      agent.state.activeTicket = null;
      await agent.save();
      return ctx.reply('Ticket not found. It may have been deleted.');
    }
    
    // Check if agent is assigned to this ticket
    const agentIdentifier = agent.username || `agent_${agent.telegramId}`;
    if (ticket.assignedTo !== agentIdentifier) {
      return ctx.reply(`You are not assigned to ticket #${ticketId}.`);
    }
    
    // Add the reply to the ticket messages
    ticket.messages.push({
      sender: agentIdentifier,
      text: replyMessage,
      timestamp: Date.now()
    });
    
    // Update the ticket's last update time
    ticket.updatedAt = Date.now();
    await ticket.save();
    
    // Send the reply to the user
    try {
      await ctx.telegram.sendMessage(
        ticket.userId,
        `🎫 Reply from support agent @${agentIdentifier}:\n\n${replyMessage}`
      );
      
      // Confirm to the agent
      return ctx.reply(`Message sent to user successfully.`);
      
    } catch (error) {
      logger.error(`Error sending reply to user: ${error.message}`);
      return ctx.reply('Your reply was saved but couldn\'t be delivered to the user. They may have blocked the bot.');
    }
    
  } catch (error) {
    logger.error(`Error replying to ticket: ${error.message}`);
    return ctx.reply('An error occurred while sending your reply.');
  }
};

// Resolve a ticket
const resolveTicket = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    
    // Find the support agent
    const agent = await User.findOne({ telegramId });
    if (!agent) {
      return ctx.reply('User not found. Please start a conversation with /start first.');
    }
    
    // Check if user is authorized as support staff
    if (!agent.isStaff) {
      return ctx.reply('You are not authorized to resolve tickets.');
    }
    
    // Get agent's active conversation context
    if (!agent.state || !agent.state.activeTicket) {
      return ctx.reply('No active ticket selected. Use /mytickets to select a ticket to resolve.');
    }
    
    const ticketId = agent.state.activeTicket;
    
    // Find the ticket
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      // Clear the active ticket reference
      agent.state.activeTicket = null;
      await agent.save();
      return ctx.reply('Ticket not found. It may have been deleted.');
    }
    
    // Check if agent is assigned to this ticket
    const agentIdentifier = agent.username || `agent_${agent.telegramId}`;
    if (ticket.assignedTo !== agentIdentifier) {
      return ctx.reply(`You are not assigned to ticket #${ticketId}.`);
    }
    
    // Update ticket status
    ticket.status = 'resolved';
    ticket.updatedAt = Date.now();
    
    // Add resolution message
    ticket.messages.push({
      sender: 'system',
      text: `Ticket marked as resolved by ${agentIdentifier}`,
      timestamp: Date.now()
    });
    
    await ticket.save();
    
    // Find the user who created the ticket and clear their active ticket
    const ticketUser = await User.findOne({ telegramId: ticket.userId });
    if (ticketUser && ticketUser.activeTicket && ticketUser.activeTicket.toString() === ticketId) {
      ticketUser.activeTicket = null;
      await ticketUser.save();
    }
    
    // Notify the user
    try {
      await ctx.telegram.sendMessage(
        ticket.userId,
        `🎫 Your ticket has been marked as resolved by @${agentIdentifier}.\n\n` +
        `If you're satisfied with the resolution, no further action is needed.\n` +
        `If you still need help, use /ticket to create a new support ticket.`
      );
    } catch (error) {
      logger.error(`Error notifying user about ticket resolution: ${error.message}`);
    }
    
    // Clear the agent's active ticket
    agent.state.activeTicket = null;
    await agent.save();
    
    // Get the support channel ID from env variables
    const supportChannelId = process.env.SUPPORT_CHANNEL_ID;
    
    // Update the message in the support channel if available
    if (supportChannelId) {
      try {
        // Send a notification to the support channel
        await ctx.telegram.sendMessage(
          supportChannelId,
          `🎫 Ticket #${ticket._id} has been resolved by @${agentIdentifier}\n\n` +
          `From: ${ticket.username}\n` +
          `Category: ${ticket.category}\n` +
          `Status: RESOLVED\n` +
          `Resolved at: ${new Date().toLocaleString()}`
        );
      } catch (error) {
        logger.error(`Error updating support channel: ${error.message}`);
      }
    }
    
    return ctx.reply(`Ticket #${ticketId} has been marked as resolved.`);
    
  } catch (error) {
    logger.error(`Error resolving ticket: ${error.message}`);
    return ctx.reply('An error occurred while resolving the ticket.');
  }
};

// Handle support-related messages
const handleSupportMessage = async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    const messageText = ctx.message.text;
    
    // Find the user
    const user = await User.findOne({ telegramId });
    if (!user) {
      return false; // Not a recognized user
    }
    
    // If the user has an active ticket and is not staff, treat their message as a reply to their ticket
    if (user.activeTicket && !user.isStaff) {
      const ticket = await Ticket.findById(user.activeTicket);
      
      if (ticket && (ticket.status === 'open' || ticket.status === 'in-progress')) {
        // Add user's message to the ticket
        const senderName = user.username || `user_${user.telegramId}`;
        
        ticket.messages.push({
          sender: senderName,
          text: messageText,
          timestamp: Date.now()
        });
        
        ticket.updatedAt = Date.now();
        await ticket.save();
        
        // If the ticket is assigned to an agent, forward the message
        if (ticket.assignedTo) {
          // Find the agent by username or ID pattern
          let agent;
          
          if (ticket.assignedTo.startsWith('agent_')) {
            // Extract the telegramId from agent_XXXXXX format
            const agentId = parseInt(ticket.assignedTo.split('_')[1]);
            agent = await User.findOne({ telegramId: agentId });
          } else {
            // Find by username
            agent = await User.findOne({ username: ticket.assignedTo });
          }
          
          if (agent) {
            // Forward the message to the agent
            try {
              await ctx.telegram.sendMessage(
                agent.telegramId,
                `📩 New message from ${senderName} on ticket #${ticket._id}:\n\n${messageText}\n\n` +
                `To reply, use: /reply Your response here`
              );
            } catch (error) {
              logger.error(`Error forwarding message to agent: ${error.message}`);
            }
          }
        }
        
        // Acknowledge receipt to the user
        await ctx.reply('Your message has been added to your ticket. An agent will respond soon.');
        return true;
      }
    }
    
    // If the user is staff and has an active ticket context, they might be trying to reply
    if (user.isStaff && user.state && user.state.activeTicket) {
      // Check if they forgot to use /reply
      await ctx.reply(
        'It seems like you\'re trying to respond to a ticket.\n' +
        'Please use the /reply command followed by your message.\n\n' +
        'Example: /reply Hello, I\'ll be helping you with your issue.'
      );
      return true;
    }
    
    return false; // Not a support-related message
    
  } catch (error) {
    logger.error(`Error handling support message: ${error.message}`);
    return false;
  }
};

// Handle resolve button callback
const resolveTicketCallback = async (ctx, ticketId) => {
  try {
    const telegramId = ctx.from.id;
    
    // Find the support agent
    const agent = await User.findOne({ telegramId });
    if (!agent) {
      return ctx.answerCbQuery('User not found. Please start a conversation with /start first.');
    }
    
    // Check if user is authorized as support staff
    if (!agent.isStaff) {
      return ctx.answerCbQuery('You are not authorized to resolve tickets.');
    }
    
    // Find the ticket
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return ctx.answerCbQuery('Ticket not found. It may have been deleted.');
    }
    
    // Check if agent is assigned to this ticket
    const agentIdentifier = agent.username || `agent_${agent.telegramId}`;
    if (ticket.assignedTo !== agentIdentifier) {
      return ctx.answerCbQuery(`You are not assigned to ticket #${ticketId}.`);
    }
    
    // Set this ticket as the agent's active context
    await User.updateOne(
      { telegramId },
      { $set: { 'state.activeTicket': ticketId } }
    );
    
    // Update ticket status
    ticket.status = 'resolved';
    ticket.updatedAt = Date.now();
    
    // Add resolution message
    ticket.messages.push({
      sender: 'system',
      text: `Ticket marked as resolved by ${agentIdentifier}`,
      timestamp: Date.now()
    });
    
    await ticket.save();
    
    // Find the user who created the ticket
    const ticketUser = await User.findOne({ telegramId: ticket.userId });
    if (ticketUser && ticketUser.activeTicket && ticketUser.activeTicket.toString() === ticketId) {
      // Clear the active ticket reference
      ticketUser.activeTicket = null;
      await ticketUser.save();
    }
    
    // Notify the user
    try {
      await ctx.telegram.sendMessage(
        ticket.userId,
        `🎫 Your ticket has been marked as resolved by @${agentIdentifier}.\n\n` +
        `If you're satisfied with the resolution, no further action is needed.\n` +
        `If you still need help, use /ticket to create a new support ticket.`
      );
    } catch (error) {
      logger.error(`Error notifying user about ticket resolution: ${error.message}`);
    }
    
    // Update the message in the support channel/private chat
    await ctx.editMessageText(
      `🎫 Ticket #${ticket._id} [RESOLVED]\n\n` +
      `From: ${ticket.username}\n` +
      `Category: ${ticket.category}\n` +
      `Description: ${ticket.description.substring(0, 100)}${ticket.description.length > 100 ? '...' : ''}\n\n` +
      `Resolved by: @${agentIdentifier} on ${new Date().toLocaleString()}`
    );
    
    // Get the support channel ID from env variables
    const supportChannelId = process.env.SUPPORT_CHANNEL_ID;
    
    // Also update or notify the support channel if it's not where the callback came from
    if (supportChannelId && ctx.chat.id.toString() !== supportChannelId.toString()) {
      try {
        // Send a notification to the support channel about the resolution
        await ctx.telegram.sendMessage(
          supportChannelId,
          `🎫 Ticket #${ticket._id} has been resolved by @${agentIdentifier}\n\n` +
          `From: ${ticket.username}\n` +
          `Category: ${ticket.category}\n` +
          `Status: RESOLVED\n` +
          `Resolved at: ${new Date().toLocaleString()}`
        );
      } catch (error) {
        logger.error(`Error updating support channel: ${error.message}`);
      }
    }
    
    await ctx.answerCbQuery('Ticket marked as resolved successfully!');
    logger.info(`Ticket ${ticketId} resolved by agent ${telegramId}`);
    
    return true;
  } catch (error) {
    logger.error(`Error resolving ticket: ${error.message}`);
    await ctx.answerCbQuery('An error occurred while resolving the ticket.');
    return false;
  }
};

// Set reply context for an agent
const setReplyContext = async (ctx, ticketId) => {
  try {
    const telegramId = ctx.from.id;
    
    // Find the support agent
    const agent = await User.findOne({ telegramId });
    if (!agent) {
      return ctx.answerCbQuery('User not found. Please start a conversation with /start first.');
    }
    
    // Check if user is authorized as support staff
    if (!agent.isStaff) {
      return ctx.answerCbQuery('You are not authorized to reply to tickets.');
    }
    
    // Find the ticket
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return ctx.answerCbQuery('Ticket not found. It may have been deleted.');
    }
    
    // Check if agent is assigned to this ticket
    const agentIdentifier = agent.username || `agent_${agent.telegramId}`;
    if (ticket.assignedTo !== agentIdentifier) {
      return ctx.answerCbQuery(`You are not assigned to ticket #${ticketId}.`);
    }
    
    // Set this ticket as the agent's active context
    await User.updateOne(
      { telegramId },
      { $set: { 'state.activeTicket': ticketId } }
    );
    
    await ctx.answerCbQuery('You can now reply to this ticket');
    await ctx.reply(
      `You are now replying to ticket #${ticketId}.\n\n` +
      `To send a message to the user, use:\n` +
      `/reply Your message here\n\n` +
      `The reply will be sent directly to the user.`
    );
    
    return true;
  } catch (error) {
    logger.error(`Error setting reply context: ${error.message}`);
    await ctx.answerCbQuery('An error occurred while setting up reply context.');
    return false;
  }
};

// Cancel/close a ticket by the user
const cancelUserTicket = async (ctx, ticketId) => {
  try {
    const telegramId = ctx.from.id;
    
    // Find the user
    const user = await User.findOne({ telegramId });
    if (!user) {
      return ctx.answerCbQuery('User not found. Please start a conversation with /start first.');
    }
    
    // Check if this is the user's active ticket
    if (!user.activeTicket || user.activeTicket.toString() !== ticketId) {
      return ctx.answerCbQuery('This is not your active ticket.');
    }
    
    // Find the ticket
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      // Clean up if the ticket was deleted
      user.activeTicket = null;
      await user.save();
      return ctx.answerCbQuery('Ticket not found.');
    }
    
    // Check if ticket belongs to this user
    if (ticket.userId !== telegramId) {
      return ctx.answerCbQuery('You are not authorized to cancel this ticket.');
    }
    
    // Check if ticket is already closed or resolved
    if (ticket.status === 'closed' || ticket.status === 'resolved') {
      return ctx.answerCbQuery('This ticket is already closed or resolved.');
    }
    
    // Update ticket status
    ticket.status = 'closed';
    ticket.updatedAt = Date.now();
    
    // Add closure message
    ticket.messages.push({
      sender: 'system',
      text: `Ticket closed by user ${user.username || telegramId}`,
      timestamp: Date.now()
    });
    
    await ticket.save();
    
    // Clear user's active ticket
    user.activeTicket = null;
    await user.save();
    
    // Notify support agent if assigned
    if (ticket.assignedTo) {
      try {
        // Find agent by username or ID
        let agent;
        
        if (ticket.assignedTo.startsWith('agent_')) {
          // Extract the telegramId from agent_XXXXXX format
          const agentId = parseInt(ticket.assignedTo.split('_')[1]);
          agent = await User.findOne({ telegramId: agentId });
        } else {
          // Find by username
          agent = await User.findOne({ username: ticket.assignedTo });
        }
        
        if (agent) {
          await ctx.telegram.sendMessage(
            agent.telegramId,
            `🎫 Ticket #${ticket._id} has been closed by the user.`
          );
        }
      } catch (error) {
        logger.error(`Error notifying agent about ticket closure: ${error.message}`);
      }
    }
    
    // Update the message to show ticket is closed
    await ctx.editMessageText(
      `🎫 Your ticket #${ticket._id}\n\n` +
      `Category: ${ticket.category}\n` +
      `Status: Closed (by you)\n` +
      `Closed on: ${new Date().toLocaleString()}\n\n` +
      `Thank you for using our support service. If you need further assistance, please create a new ticket with /ticket.`
    );
    
    await ctx.answerCbQuery('Ticket closed successfully.');
    logger.info(`User ${telegramId} closed ticket ${ticketId}`);
    
    return true;
  } catch (error) {
    logger.error(`Error closing ticket: ${error.message}`);
    await ctx.answerCbQuery('An error occurred while closing the ticket.');
    return false;
  }
};

// Export all functions
module.exports = {
  viewAssignedTickets,
  claimTicket,
  viewTicket,
  viewUserTicket,
  replyToTicket,
  resolveTicket,
  handleSupportMessage,
  resolveTicketCallback,
  setReplyContext,
  cancelUserTicket
};