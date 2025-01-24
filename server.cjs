const express = require('express');
const mongoose = require('mongoose');
const screenshot = require('screenshot-desktop');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const nodemailer = require('nodemailer'); 
const AWS = require('aws-sdk');
const dotenv=require('dotenv');
const multer=require('multer');
require('dotenv').config();


const app = express();
const PORT = 5002;

// AWS S3 Configuration
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ,      // Your AWS Access Key
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ,  // Your AWS Secret Access Key
    region: process.env.AWS_REGION                   // Your AWS Region
});

const bucketName = process.env.S3_BUCKET_NAME ||"time-tracking-persist-ventures";        // S3 bucket name

AWS.config.getCredentials(function(err) {
    if (err) {
      console.error('Error loading AWS credentials:', err);
    } else {
      console.log('AWS Credentials loaded successfully');
    }
  });


// MongoDB connection
const mongoURI = process.env.MONGO_URI; 
mongoose.connect(mongoURI, {})
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.log('MongoDB connection error:', err));

    const projectSchema = new mongoose.Schema({
        projectName: { type: String, required: true }, 
        clientName: { type: String, required: true },  
        isBillable: { type: Boolean, default: false }, 
        members: {
            managers: { type: [String], default: [] },  
            users: { type: [String], default: [] },     
            viewers: { type: [String], default: [] }    
        },
        budget: {
            budgetType: { type: String, required: true }, 
            basedOn: { type: String, required: true },    
            cost: { type: Number, required: true }        
        },
        teams: { type: [String], required: true } 
    });

const screenshotSchema = new mongoose.Schema({
    userId: String,          // User ID for tracking who took the screenshot
    projectId: String,
    timestamp: { 
        type: Date, 
        default: Date.now     // Automatically adds the date and time of the screenshot
    },
    imagePath: String        // Path to the saved screenshot
});

const Screenshot = mongoose.model('Screenshot', screenshotSchema);
const Project = mongoose.model('Project', projectSchema);

// Middleware
app.use(bodyParser.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Add the root route ("/") to serve the "index.html"
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// POST endpoint to save a new project
app.post('/projects', async (req, res) => {
    console.log('Received data:', req.body);  // Log the received data

    try {
        // Create the new project using the request body
        const newProject = new Project({
            projectName: req.body.projectName,
            clientName: req.body.clientName,
            isBillable: req.body.isBillable || false,
            members: {
                managers: req.body.managers ? req.body.managers.split(',').map(item => item.trim()) : [], // Split and trim to handle extra spaces
                users: req.body.users ? req.body.users.split(',').map(item => item.trim()) : [],
                viewers: req.body.viewers ? req.body.viewers.split(',').map(item => item.trim()) : []
            },
            budget: {
                budgetType: req.body.budgetType || '',
                basedOn: req.body.basedOn || '',
                cost: parseFloat(req.body.cost) || 0 // Ensure cost is stored as a number
            },
            teams: req.body.teamsSearch ? [req.body.teamsSearch] : [] // Store teams in an array
        });

        const savedProject = await newProject.save();
        res.status(201).json(savedProject);
    } catch (error) {
        console.error('Error saving project:', error);  // Detailed error logging
        res.status(500).json({ error: error.message });
    }
});

app.use(bodyParser.json()); // Ensure this line is present




// GET endpoint to fetch all projects
app.get('/projects', async (req, res) => {
    try {
        const projects = await Project.find();
        res.status(200).json(projects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Store project members
app.post('/projects/members', async (req, res) => {
    const { projectId, managers, users, viewers } = req.body;

    try {
        const project = await Project.findById(projectId);
        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        project.members.managers = managers || [];
        project.members.users = users || [];
        project.members.viewers = viewers || [];
        await project.save();

        res.status(200).json(project);
    } catch (error) {
        console.error('Error saving members:', error);
        res.status(400).json({ error: error.message });
    }
});
// Endpoint to get projects worked this week
app.get('/api/projects/this-week', async (req, res) => {
    try {
        const startOfWeek = new Date();
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()); // Start of the week (Sunday)

        const projectsThisWeek = await Project.find({
            createdAt: { $gte: startOfWeek } // Filter projects created this week
        });

        res.status(200).json({ count: projectsThisWeek.length });
    } catch (error) {
        res.status(500).json({ error: 'Error fetching projects', details: error.message });
    }
});

// Endpoint to get projects worked today
app.get('/api/projects/today', async (req, res) => {
    try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0); // Start of the day

        const projectsToday = await Project.find({
            createdAt: { $gte: startOfDay } // Filter projects created today
        });

        res.status(200).json({ count: projectsToday.length });
    } catch (error) {
        res.status(500).json({ error: 'Error fetching projects', details: error.message });
    }
});


// Save budget to a project
app.post('/projects/budget', async (req, res) => {
    try {
        const { budgetType, basedOn, cost, projectId } = req.body;
        const project = await Project.findById(projectId);

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        project.budget.budgetType = budgetType || project.budget.budgetType;
        project.budget.basedOn = basedOn || project.budget.basedOn;
        project.budget.cost = cost || project.budget.cost;
        await project.save();

        res.status(200).json(project);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Save teams to a project
app.post('/projects/teams', async (req, res) => {
    try {
        const { teamsSearch, projectId } = req.body;
        const project = await Project.findById(projectId);

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        project.teams.push(teamsSearch); // Add team to the existing array
        await project.save();

        res.status(200).json(project);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});



// Define the /api/upload-screenshot endpoint
// Configure multer
const upload = multer({ storage: multer.memoryStorage() });

// Define the /api/upload-screenshot endpoint
app.post('/api/upload-screenshot', upload.single('screenshot'), async (req, res) => {
    const userId = req.body.userId || "user123";
    const timestamp = req.body.timestamp ? new Date(req.body.timestamp) : new Date();

    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const s3Params = {
            Bucket: bucketName,
            Key: `screenshots/screenshot-${timestamp.toISOString()}.png`,
            Body: req.file.buffer,
            ContentType: req.file.mimetype,
        };

        s3.upload(s3Params, async (err, data) => {
            if (err) {
                console.error('Error uploading to S3:', err);
                return res.status(500).json({ success: false, message: 'Error uploading to S3', details: err });
            }

            const newScreenshot = new Screenshot({
                userId,
                timestamp,          // Save the provided timestamp
                imageUrl: data.Location // S3 URL
            });

            await newScreenshot.save();

            res.status(201).json({
                success: true,
                message: 'Screenshot uploaded successfully to S3',
                screenshot: newScreenshot
            });
        });
    } catch (error) {
        console.error('Error saving uploaded screenshot:', error);
        res.status(500).json({ success: false, message: 'Error saving uploaded screenshot', details: error.message });
    }
});


// Retrieve user activities
// app.get('/api/get-activity/:userId', (req, res) => {
//     const userId = req.params.userId;
//     UserActivity.find({ userId: userId })
//         .then(activities => res.json(activities))
//         .catch(err => res.status(500).json({ error: 'Error retrieving user activities', details: err }));
// });

// Retrieve screenshots
app.get('/api/get-screenshots/:userId', (req, res) => {
    const userId = req.params.userId;
    Screenshot.find({ userId: userId })
        .then(screenshots => {
            console.log('Retrieved Screenshots:', screenshots);  // Log the screenshots to the console
            res.json(screenshots);  // Send the screenshots in the response
        })
        .catch(err => {
            console.error('Error retrieving screenshots:', err);  // Log the error to the console
            res.status(500).json({ error: 'Error retrieving screenshots', details: err });
        });
        // Limit the number of screenshots fetched (e.g., 5)
        const maxScreenshots = 6;
        const screenshotUrls = data.Contents.map(item => {
            return {
                url: `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${item.Key}`,
                timestamp: item.LastModified
            };
        }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, maxScreenshots);  // Limit to the most recent 5

});



// Endpoint to fetch recent screenshots from S3 bucket
// app.get('/api/recent-screenshots', async (req, res) => {
//     try {
//         const params = {
//             Bucket: bucketName,
//             Prefix: 'screenshots/', // Adjust if your folder structure is different
//         };

//         const data = await s3.listObjectsV2(params).promise();
//         if (!data || !data.Contents || data.Contents.length === 0) {
//             return res.status(404).json({ message: 'No screenshots found' });
//         }

//         const screenshots = data.Contents.map(item => ({
//             url: `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${item.Key}`,
//             timestamp: item.LastModified
//         }));

//         res.status(200).json(screenshots);
//     } catch (error) {
//         console.error('Error fetching screenshots:', error.message);
//         res.status(500).json({ message: 'Error fetching screenshots', error: error.message });
//     }
// });




const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true, // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL_USER, // Gmail user
        pass: process.env.EMAIL_PASS, // Gmail password or app password
    }
});

// Check if transport configuration is correct
transporter.verify(function (error, success) {
    if (error) {
        console.log("Error with transporter configuration: ", error);
    } else {
        console.log("Transporter is ready to send emails.");
    }
});

// Async function to send an email
async function sendEmail(toEmail, inviteLink) {
    try {
        // Log the email being sent and the invite link for debugging
        console.log('Preparing to send email to:', toEmail);
        console.log('Invite link:', inviteLink);

        // Send mail with defined transport object
        let info = await transporter.sendMail({
            from: `"AcTrack" <${process.env.EMAIL_USER}>`, // sender address
            to: toEmail, // receiver address
            subject: "You are invited to join the team!", // Subject line
            html: `
                <h1>Team Invitation</h1>
                <p>You have been invited to join our team. Click the link below to accept the invitation:</p>
                <a href="${inviteLink}">Join the Team</a>
            `
        });

        console.log('Message sent successfully, ID:', info.messageId); // Log success message
        return info; // Return info if successful
    } catch (error) {
        console.error('Error sending email:', error); // Log detailed error information
        throw error; // Throw error so it can be caught by the caller
    }
}

// POST endpoint to handle sending the email invitation
app.post('/api/send-invite', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        console.log('No email provided in request body.');
        return res.status(400).json({ message: 'Email is required' });
    }

    try {
        // Log received email for debugging
        console.log('Received request to send invite to:', email);

        // Generate an invitation link (replace with your actual app URL)
        const inviteLink = `http://actracker.onrender.com`;

        // Send the email
        await sendEmail(email, inviteLink);

        // Respond with success message
        console.log('Invitation sent successfully to:', email);
        res.status(200).json({ message: 'Invitation sent successfully!' });
    } catch (error) {
        console.error('Error while processing invitation request:', error);
        res.status(500).json({ error: 'Failed to send invitation', details: error.message });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
app.get('/projects/count', async (req, res) => {
    try {
        const count = await Project.countDocuments();
        res.json({ count });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});
const timeEntrySchema = new mongoose.Schema({
    userId: String,
    projectId: String,  
    workedTime: Number, // Store the total seconds worked
    date: { type: Date, default: Date.now }
});

const TimeEntry = mongoose.model('TimeEntry', timeEntrySchema);

// Helper function to convert seconds to hours, minutes, and seconds
function convertSecondsToHMSS(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    
    return { hours, minutes, seconds: remainingSeconds };
}

// POST endpoint to save time entry for a project
app.post('/api/save-time-entry', async (req, res) => {
    console.log('Received time entry request:', req.body); // Log the incoming request

    const { userId, projectId, workedTime, timestamp } = req.body;

    try {
        // Validate required fields
        if (!userId || !projectId || workedTime === undefined) {
            console.error('Missing required fields:', { userId, projectId, workedTime });
            return res.status(400).json({ 
                error: 'Missing required fields',
                details: 'userId, projectId, and workedTime are required',
                received: { userId, projectId, workedTime }
            });
        }

        // Create new time entry with the total worked time in seconds
        const newTimeEntry = new TimeEntry({
            userId,
            projectId,
            workedTime: parseInt(workedTime), // Ensure workedTime is stored as a number
            date: timestamp ? new Date(timestamp) : new Date()
        });

        // Save the time entry
        const savedTimeEntry = await newTimeEntry.save();
        console.log('Time entry saved successfully:', savedTimeEntry);

        // Send success response
        res.status(201).json({
            message: 'Time entry saved successfully',
            timeEntry: savedTimeEntry
        });
    } catch (error) {
        console.error('Error saving time entry:', error);
        res.status(500).json({ 
            error: 'Failed to save time entry',
            details: error.message 
        });
    }
});


// Example: Update when starting the timer
app.post('/start-timer', async (req, res) => {
    const { projectId } = req.body;
    try {
        // Update the last worked date when the timer starts
        const updatedProject = await Project.findByIdAndUpdate(
            projectId,
            { lastWorked: new Date() }, // Update to current date
            { new: true } // Return the updated document
        );

        if (!updatedProject) {
            return res.status(404).json({ message: 'Project not found.' });
        }

        // Start timer logic...
        res.status(200).json({ message: 'Timer started and project updated.', project: updatedProject });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});



// Endpoint to stop the timer
app.post('/stop-timer', async (req, res) => {
    const { projectId } = req.body; // Assuming you send projectId when stopping the timer

    try {
        // Update the last worked date when the timer stops
        const updatedProject = await Project.findByIdAndUpdate(
            projectId,
            { lastWorked: new Date() }, // Set to current date and time
            { new: true } // Return the updated document
        );

        if (!updatedProject) {
            return res.status(404).json({ message: 'Project not found.' });
        }

        // Stop timer logic...
        res.status(200).json({ message: 'Timer stopped and project updated.', project: updatedProject });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const userActivitySchema = new mongoose.Schema({
    userId: String,         
    projectId: String,       
    date: { type: Date, default: Date.now }, 
    mouseEvents: { type: Number, default: 0 }, 
    keyboardEvents: { type: Number, default: 0 }, 
    totalTime: { type: Number, default: 0 },
    mouseUsagePercentage: Number, 
    keyboardUsagePercentage: Number,
    projectName: String
});

const UserActivity = mongoose.model('UserActivity', userActivitySchema);
app.post('/api/save-activity', async (req, res) => {
    try {
        const {
            userId,
            projectId,
            mouseEvents,
            keyboardEvents,
            totalTime,
            mouseUsagePercentage,
            keyboardUsagePercentage
        } = req.body;

        // Save to database
        const activityData = new browserActivities({
            userId,
            projectId,
            mouseEvents,
            keyboardEvents,
            totalTime,
            mouseUsagePercentage,
            keyboardUsagePercentage
        });

        await activityData.save();
        res.status(200).json({ message: 'Activity data saved successfully' });
    } catch (error) {
        console.error('Error saving activity data:', error);
        res.status(500).json({ error: error.message });
    }
});
// app.get('/api/get-activity', async (req, res) => {
//     const { projectId } = req.params;

//     try {
//         const activities = await UserActivity.find({ projectId }).sort({ date: 1 }); // Sort by date
//         res.status(200).json(activities);
//     } catch (error) {
//         console.error('Error fetching activity data:', error);
//         res.status(500).json({ message: 'Error fetching activity data', details: error.message });
//     }
// });
app.get('/api/total-worked-time-this-week/:userId', async (req, res) => {
    const userId = req.params.userId;

    try {
        // Get the start and end of the current week
        const now = new Date();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay()); // Get Sunday
        startOfWeek.setHours(0, 0, 0, 0); // Start of day

        const endOfWeek = new Date(now);
        endOfWeek.setDate(startOfWeek.getDate() + 6); // Get Saturday
        endOfWeek.setHours(23, 59, 59, 999); // End of day

        console.log('Fetching time entries between:', startOfWeek, 'and', endOfWeek);

        // Find all time entries for this week
        const timeEntries = await TimeEntry.find({
            userId: userId,
            date: {
                $gte: startOfWeek,
                $lte: endOfWeek
            }
        });

        console.log('Found time entries:', timeEntries);

        // Calculate total seconds worked
        let totalWorkedSeconds = 0;
        timeEntries.forEach(entry => {
            if (entry.workedTime) {
                const hours = entry.workedTime.hours || 0;
                const minutes = entry.workedTime.minutes || 0;
                const seconds = entry.workedTime.seconds || 0;
                
                const entrySeconds = (hours * 3600) + (minutes * 60) + seconds;
                totalWorkedSeconds += entrySeconds;
                
                console.log('Entry time:', {
                    hours,
                    minutes,
                    seconds,
                    totalSeconds: entrySeconds
                });
            }
        });

        console.log('Total worked seconds:', totalWorkedSeconds);

        res.status(200).json({ 
            totalWorkedSeconds,
            timeEntries: timeEntries.map(entry => ({
                date: entry.date,
                workedTime: entry.workedTime
            }))
        });
    } catch (error) {
        console.error('Error calculating total worked time:', error);
        res.status(500).json({ 
            error: 'Failed to calculate worked time',
            details: error.message 
        });
    }
});
app.get('/api/activity-this-week/:userId', async (req, res) => {
    const userId = req.params.userId;

    try {
        // Get the start and end of the current week (Sunday to Saturday)
        const now = new Date();
        const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay())); // Get Sunday of this week
        startOfWeek.setHours(0, 0, 0, 0); // Set to midnight

        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(endOfWeek.getDate() + 6); // Set to Saturday
        endOfWeek.setHours(23, 59, 59, 999); // Set to end of the day

        // Fetch user activity for the current week
        const activityThisWeek = await UserActivity.find({
            userId: userId,
            date: { $gte: startOfWeek, $lte: endOfWeek }
        }).sort({ date: 1 }); // Sort by date to get activities from Sunday to Saturday

        // Send activity data to the frontend
        res.status(200).json(activityThisWeek);
    } catch (error) {
        console.error('Error fetching activity for this week:', error);
        res.status(500).json({ message: 'Error fetching activity for this week', details: error.message });
    }
});
// Fetch the most recent screenshot for the user
app.get('/api/last-screenshot/:userId', async (req, res) => {
    const userId = req.params.userId;

    try {
        // Find the most recent screenshot for the given user
        const lastScreenshot = await Screenshot.findOne({ userId: userId })
            .sort({ timestamp: -1 })  // Sort by most recent screenshot (descending)
            .exec();

        if (!lastScreenshot) {
            return res.status(404).json({ message: 'No screenshot found for this user.' });
        }

        // Return the timestamp of the last screenshot
        res.status(200).json({
            lastScreenshotTime: lastScreenshot.timestamp
        });
    } catch (error) {
        console.error('Error fetching last screenshot:', error);
        res.status(500).json({ message: 'Error fetching last screenshot', details: error.message });
    }
});
// Helper function to format seconds into HH:mm:ss
function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    // Ensure double digits for hours, minutes, and seconds (e.g., "01:09:08")
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

// app.get('/api/last-worked-time/:userId', async (req, res) => {
//     try {
//         const { userId } = req.params;

//         // Fetch the latest TimeEntry for the user, sorted by date (descending)
//         const latestTimeEntry = await TimeEntry.findOne({ userId })
//             .sort({ date: -1 }) // Sort by date descending (latest first)
//             .exec();

//         if (!latestTimeEntry) {
//             return res.status(404).json({ message: 'No time entries found for this user.' });
//         }

//         // Convert workedTime (seconds) to HH:mm:ss format
//         const formattedWorkedTime = formatTime(latestTimeEntry.workedTime);

//         res.status(200).json({
//             workedTime: formattedWorkedTime,
//             date: new Date(latestTimeEntry.date).toLocaleString() // Return the formatted date
//         });
//     } catch (error) {
//         console.error('Error fetching last worked time:', error);
//         res.status(500).json({ message: 'Error fetching last worked time', details: error.message });
//     }
// });

// Endpoint to retrieve recent screenshots
app.get('/api/recent-screenshots', async (req, res) => {
    try {
        const params = {
            Bucket: bucketName,
            Prefix: 'screenshots/', // Adjust if your folder structure is different
        };

        const data = await s3.listObjectsV2(params).promise();

        if (!data.Contents || data.Contents.length === 0) {
            return res.status(404).json({ message: 'No screenshots found' });
        }

        // Map screenshots to include key for deletion
        const screenshots = data.Contents.map(item => ({
            url: `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${item.Key}`,
            key: item.Key,
            timestamp: item.LastModified
        }));

        res.status(200).json(screenshots);
    } catch (error) {
        console.error('Error fetching screenshots:', error.message);
        res.status(500).json({ message: 'Error fetching screenshots', error: error.message });
    }
});
app.get('/api/recent-screenshots', async (req, res) => {
    try {
        const params = {
            Bucket: bucketName,
            Prefix: 'screenshots/', // Adjust if your folder structure is different
        };

        const data = await s3.listObjectsV2(params).promise();
        if (!data || !data.Contents || data.Contents.length === 0) {
            return res.status(404).json({ message: 'No screenshots found' });
        }

        const screenshots = data.Contents
            .map(item => ({
                url: `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${item.Key}`,
                timestamp: item.LastModified
            }))
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)); // Sort by timestamp in descending order

        // Optionally, you can limit the number of screenshots returned
        const limit = 50; // Adjust this number as needed
        const limitedScreenshots = screenshots.slice(0, limit);

        res.status(200).json(limitedScreenshots);
    } catch (error) {
        console.error('Error fetching screenshots:', error.message);
        res.status(500).json({ message: 'Error fetching screenshots', error: error.message });
    }
});
const browserActivitiesSchema = new mongoose.Schema({
    userId: String,
    projectId: String,
    title: String,
    application: String,
    timeSpentPercentage: Number,
    tabTitle: String,  // Specific tab or file name
    url: String,       // For browser tabs
    path: String,      // For editor files
    date: { type: Date, default: Date.now }
});

const browserActivities = mongoose.model('browserActivities', browserActivitiesSchema);

module.exports = { browserActivities };

// 1. Get recent activities (previously tracked data)
app.get('/api/activities', async (req, res) => {
    try {
        const activities = await browserActivities.find().sort({ date: -1 }).limit(5); // Fetch the last 5 activities
        res.status(200).json(activities); // Send the activities as JSON response
    } catch (error) {
        console.error('Error fetching activities:', error);
        res.status(500).json({ error: `Internal server error: ${error.message}` });
    }
});

// 2. Save new activity data
app.post('/api/browser-activities', async (req, res) => {
    const activities = req.body.activities;

    // Log the received activities to check what is coming in the request
    console.log('Received activities:', JSON.stringify(activities, null, 2)); // Pretty print to inspect the payload

    // Validate that activities is an array
    if (!Array.isArray(activities)) {
        console.error('Error: activities is not an array');
        return res.status(400).json({ error: 'Invalid data format: activities should be an array' });
    }

    // Validate the structure of each activity
    for (let activity of activities) {
        const { userId, projectId, title, application, timeSpentPercentage } = activity;
        
        // Check if any of the required fields are missing
        if (!userId || !projectId || !title || !application || timeSpentPercentage == null) {
            console.error('Missing required fields in activity:', activity);
            return res.status(400).json({ error: 'Missing required fields in activity data' });
        }
    }

    try {
        // Save each activity document to the database
        for (let activity of activities) {
            const { userId, projectId, title, application, timeSpentPercentage } = activity;

            const activityDoc = new browserActivities({
                userId,
                projectId,
                title,
                application,
                timeSpentPercentage,
            });

            await activityDoc.save();
        }

        res.status(201).json({ message: 'Activities saved successfully' });
    } catch (error) {
        console.error('Error saving activity:', error);
        res.status(500).json({ error: `Internal server error: ${error.message}` });
    }
});

// Add this endpoint to fetch last worked time from TimeEntry collection
app.get('/api/last-worked-time/:userId', async (req, res) => {
    const userId = req.params.userId;

    try {
        // Find the most recent time entry for the user
        const lastTimeEntry = await TimeEntry.findOne({ userId })
            .sort({ date: -1 })
            .exec();

        if (!lastTimeEntry) {
            return res.status(200).json({ 
                message: 'No time entries found',
                lastWorkedTime: null 
            });
        }

        // Get the project details
        const project = await Project.findById(lastTimeEntry.projectId);

        res.status(200).json({
            lastWorkedTime: lastTimeEntry.date,
            projectName: project ? project.projectName : 'Unknown Project',
            workedTime: lastTimeEntry.workedTime
        });
    } catch (error) {
        console.error('Error fetching last worked time:', error);
        res.status(500).json({ 
            error: 'Failed to fetch last worked time',
            details: error.message 
        });
    }
});

// Add this endpoint if it's not already present
app.get('/api/last-worked-time/:userId', async (req, res) => {
    const userId = req.params.userId;

    try {
        // Find the most recent time entry
        const lastEntry = await TimeEntry.findOne({ 
            userId: userId 
        })
        .sort({ date: -1 })
        .limit(1);

        if (!lastEntry) {
            return res.json({ lastWorkedTime: null });
        }

        res.json({ 
            lastWorkedTime: lastEntry.date,
            projectId: lastEntry.projectId
        });
    } catch (error) {
        console.error('Error fetching last worked time:', error);
        res.status(500).json({ 
            error: 'Failed to fetch last worked time',
            details: error.message 
        });
    }
});