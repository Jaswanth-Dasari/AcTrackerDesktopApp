const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// User Schema
const userSchema = new mongoose.Schema({
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    userId: { type: String, required: true, unique: true }
});

userSchema.pre('save', async function (next) {
    if (this.isNew) {
        try {
            const lastUser = await mongoose.model('User').findOne().sort({ userId: -1 }).exec();
            if (lastUser && lastUser.userId) {
                const lastId = parseInt(lastUser.userId.slice(2));
                this.userId = `US${String(lastId + 1).padStart(4, '0')}`;
            } else {
                this.userId = 'US0001';
            }
        } catch (err) {
            console.error('Error generating userId:', err);
            next(err);
        }
    }
    next();
});

// Daily Time Schema
const dailyTimeSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true
    },
    date: {
        type: Date,
        required: true
    },
    totalSeconds: {
        type: Number,
        default: 0
    },
    tasks: [{
        taskId: String,
        seconds: Number,
        title: String,
        projectName: String
    }]
}, { timestamps: true });

// Task Schema
const taskSchema = new mongoose.Schema({
    taskId: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    projectId: { type: String },
    title: String,
    description: String,
    status: { type: String, default: 'Not Started' },
    priority: { type: String, default: 'High' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    metadata: {
        sprint: String,
        epic: String,
        labels: [String],
        dependencies: [String],
        attachments: [String]
    },
    timing: {
        startDate: Date,
        dueDate: Date,
        estimate: Number,
        worked: Number,
        timeLogged: { type: String, default: '0 Hours' }
    },
    recurring: {
        isRecurring: { type: Boolean, default: false },
        untilDate: Date,
        days: [String]
    },
    assignee: {
        userId: String,
        assignedAt: Date
    },
    project: {
        projectId: String,
        projectName: String
    }
});

// Create models
const User = mongoose.model('User', userSchema);
const Task = mongoose.model('Task', taskSchema);
const DailyTime = mongoose.model('DailyTime', dailyTimeSchema);

// Authentication middleware
const authenticateToken = (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        if (!authHeader) {
            return res.status(401).json({ error: 'No authorization header' });
        }

        const token = authHeader.split(' ')[1];
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
            if (err) {
                console.error('Token verification failed:', err);
                return res.status(403).json({ error: 'Invalid token' });
            }
            req.user = decoded;
            next();
        });
    } catch (error) {
        console.error('Authentication error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
};

// Auth Routes
app.post('/api/register', async (req, res) => {
    try {
        const { fullName, email, password } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create new user
        const user = new User({
            fullName,
            email,
            password: hashedPassword
        });

        await user.save();
        res.status(201).json({ message: 'Registration successful' });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find user
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate token
        const token = jwt.sign(
            { userId: user.userId, email: user.email, fullName: user.fullName },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            token,
            userId: user.userId,
            fullName: user.fullName
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Task Routes
app.get('/api/tasks/:userId', authenticateToken, async (req, res) => {
    try {
        const tasks = await Task.find({ userId: req.params.userId });
        res.json(tasks);
    } catch (error) {
        console.error('Error fetching tasks:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/tasks/create', authenticateToken, async (req, res) => {
    try {
        const taskId = `task_${Date.now()}`;
        const {
            userId,
            projectId,
            title,
            description,
            status = 'Not Started',
            priority,
            sprint,
            epic,
            labels,
            dependencies,
            attachments,
            timing,
            recurring,
            assignee,
            project
        } = req.body;

        // Validate required fields
        if (!userId) {
            return res.status(400).json({ 
                error: 'Missing required fields',
                details: 'userId is required'
            });
        }

        // Parse dates from timing object
        const parsedTiming = {
            startDate: timing?.startDate ? new Date(timing.startDate) : null,
            dueDate: timing?.dueDate ? new Date(timing.dueDate) : null,
            estimate: timing?.estimate ? Number(timing.estimate) : 0,
            worked: timing?.worked ? Number(timing.worked) : 0,
            timeLogged: timing?.timeLogged || '0 Hours'
        };

        // Parse recurring dates and ensure days array
        const parsedRecurring = {
            isRecurring: Boolean(recurring?.isRecurring),
            untilDate: recurring?.untilDate ? new Date(recurring.untilDate) : null,
            days: Array.isArray(recurring?.days) ? recurring.days : []
        };

        // Calculate priority based on due date
        let calculatedPriority;
        if (parsedTiming.dueDate) {
            const today = new Date();
            const daysUntilDue = Math.ceil((parsedTiming.dueDate - today) / (1000 * 60 * 60 * 24));
            
            if (daysUntilDue <= 3) {
                calculatedPriority = 'High';
            } else if (daysUntilDue <= 7) {
                calculatedPriority = 'Medium';
            } else {
                calculatedPriority = 'Low';
            }
            console.log('Calculated priority based on due date:', { daysUntilDue, calculatedPriority });
        } else {
            calculatedPriority = priority || 'Medium';
            console.log('Using provided priority or default:', calculatedPriority);
        }

        // Ensure project details are properly structured
        const projectDetails = project || {};
        const finalProjectId = projectDetails.projectId || projectId;
        const finalProjectName = projectDetails.projectName || 'No Project';

        // Parse metadata fields
        const parsedMetadata = {
            sprint: sprint || null,
            sprintName: req.body.sprintName || null,
            epic: epic || null,
            epicName: req.body.epicName || null,
            labels: Array.isArray(labels) ? labels : [],
            dependencies: Array.isArray(dependencies) ? dependencies : [],
            attachments: Array.isArray(attachments) ? attachments : []
        };

        console.log('Creating task with details:', {
            projectId: finalProjectId,
            projectName: finalProjectName,
            timing: parsedTiming,
            recurring: parsedRecurring,
            priority: calculatedPriority,
            metadata: parsedMetadata
        });

        const task = new Task({
            taskId,
            userId,
            projectId: finalProjectId,
            title,
            description,
            status,
            priority: calculatedPriority,
            metadata: parsedMetadata,
            timing: parsedTiming,
            recurring: parsedRecurring,
            assignee: assignee ? {
                userId: assignee.userId,
                assignedAt: new Date(assignee.assignedAt)
            } : null,
            project: {
                projectId: finalProjectId,
                projectName: finalProjectName
            }
        });

        const savedTask = await task.save();
        console.log('Task saved successfully:', savedTask);
        res.status(201).json(savedTask);
    } catch (error) {
        console.error('Error creating task:', error);
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/tasks/:taskId', authenticateToken, async (req, res) => {
    try {
        // First get the existing task
        const existingTask = await Task.findOne({ taskId: req.params.taskId });
        if (!existingTask) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // If there's a timing update, merge it with existing timing
        if (req.body.timing) {
            req.body.timing = {
                ...existingTask.timing.toObject(),  // Convert to plain object
                ...req.body.timing
            };
        }

        // Update the task with merged data
        const task = await Task.findOneAndUpdate(
            { taskId: req.params.taskId },
            req.body,
            { new: true }
        );
        
        res.json(task);
    } catch (error) {
        console.error('Error updating task:', error);
        res.status(500).json({ error: error.message });
    }
});

// Daily Time Routes
app.get('/api/daily-time/:userId', authenticateToken, async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        let dailyTime = await DailyTime.findOne({
            userId: req.params.userId,
            date: {
                $gte: today,
                $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
            }
        });
        
        if (!dailyTime) {
            dailyTime = new DailyTime({
                userId: req.params.userId,
                date: today,
                totalSeconds: 0,
                tasks: []
            });
            await dailyTime.save();
        }
        
        res.json(dailyTime);
    } catch (error) {
        console.error('Error fetching daily time:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/daily-time/all/:userId', authenticateToken, async (req, res) => {
    try {
        const dailyTimes = await DailyTime.find({ userId: req.params.userId });
        res.json(dailyTimes);
    } catch (error) {
        console.error('Error fetching all daily times:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/daily-time/update', authenticateToken, async (req, res) => {
    try {
        const { userId, date, taskId, seconds, title, projectName } = req.body;

        // Validate required fields
        if (!userId || !date) {
            return res.status(400).json({ 
                error: 'Missing required fields',
                details: 'userId and date are required'
            });
        }

        // Parse and validate the date
        const dayStart = new Date(date);
        if (isNaN(dayStart.getTime())) {
            return res.status(400).json({ 
                error: 'Invalid date format',
                details: 'Please provide a valid date'
            });
        }

        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setHours(23, 59, 59, 999);
        
        // Find or create daily time entry
        let dailyTime = await DailyTime.findOne({
            userId,
            date: {
                $gte: dayStart,
                $lt: dayEnd
            }
        });
        
        if (!dailyTime) {
            dailyTime = new DailyTime({
                userId,
                date: dayStart,
                totalSeconds: 0,
                tasks: []
            });
        }
        
        // Update task information
        const existingTaskIndex = dailyTime.tasks.findIndex(t => t.taskId === taskId);
        if (existingTaskIndex !== -1) {
            dailyTime.tasks[existingTaskIndex].seconds += seconds || 0;
            if (title) dailyTime.tasks[existingTaskIndex].title = title;
            if (projectName) dailyTime.tasks[existingTaskIndex].projectName = projectName;
        } else {
            dailyTime.tasks.push({ 
                taskId: taskId || 'default',
                seconds: seconds || 0,
                title: title || 'Untitled Task',
                projectName: projectName || 'Default Project'
            });
        }
        
        // Recalculate total seconds
        dailyTime.totalSeconds = dailyTime.tasks.reduce((total, task) => total + (task.seconds || 0), 0);
        
        // Save the updated document
        await dailyTime.save();
        
        // Return formatted response
        res.json({
            success: true,
            dailyTime: {
                userId: dailyTime.userId,
                date: dailyTime.date,
                totalSeconds: dailyTime.totalSeconds,
                formattedTime: formatTime(dailyTime.totalSeconds),
                tasks: dailyTime.tasks
            }
        });
    } catch (error) {
        console.error('Error updating daily time:', error);
        res.status(500).json({ 
            error: 'Failed to update daily time',
            details: error.message 
        });
    }
});

// Helper function to format seconds into HH:MM:SS
function formatTime(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
const PORT = process.env.PORT || 5002;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});