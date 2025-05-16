const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./src/models/user');

// Load environment variables
dotenv.config();

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(async () => {
    console.log('Connected to MongoDB');
    
    try {
      // Get admin user IDs from env
      const adminUserIds = process.env.ADMIN_USER_IDS 
        ? process.env.ADMIN_USER_IDS.split(',').map(id => parseInt(id.trim())) 
        : [];
      
      if (adminUserIds.length === 0) {
        console.log('No admin user IDs specified in .env file');
        process.exit(0);
      }
      
      console.log(`Found ${adminUserIds.length} admin IDs to process`);
      
      // Process each ID
      for (const telegramId of adminUserIds) {
        // Find or create user
        let user = await User.findOne({ telegramId });
        
        if (!user) {
          console.log(`Creating new user for ID: ${telegramId}`);
          user = new User({
            telegramId,
            username: `admin_${telegramId}`,
            isStaff: true,
            role: 'admin'
          });
          await user.save();
          console.log(`Created new admin user with ID: ${telegramId}`);
        } else {
          // Update existing user to be staff/admin if not already
          if (!user.isStaff || user.role !== 'admin') {
            console.log(`Updating user ${telegramId} to admin role`);
            user.isStaff = true;
            user.role = 'admin';
            await user.save();
            console.log(`Updated user ${telegramId} to admin role`);
          } else {
            console.log(`User ${telegramId} is already an admin`);
          }
        }
      }
      
      console.log('Staff setup complete');
      process.exit(0);
    } catch (error) {
      console.error('Error setting up staff users:', error);
      process.exit(1);
    }
  })
  .catch(err => {
    console.error('Error connecting to MongoDB:', err);
    process.exit(1);
  });