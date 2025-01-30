// DOM Elements
const addTaskBtn = document.querySelector('.add-task-btn');
const modal = document.getElementById('add-task-modal');
const closeModalBtn = document.querySelector('.close-modal');
const playButton = document.querySelector('.play-button');
const timerDisplay = document.querySelector('.timer-display');
const elapsedTime = document.querySelector('.elapsed-time');
const completeTaskBtn = document.querySelector('.complete-task-btn');
const projectSelect = document.getElementById('project');
const projectInfo = document.querySelector('.project-info');

// State
let isTracking = false;
let elapsedSeconds = 0;
let timerInterval = null;
let totalHoursInterval;
let selectedTask = null;
let currentProject = null;
let allTasks = [];
let filteredTasks = [];
let currentPage = 1;
let selectedTimePeriod = 90; // Default to 90 days
const tasksPerPage = 10;

// Add these variables to the existing state section
let activeFilters = {
    assignees: [],
    status: [],
    priority: [],
    projects: [],
    dateRange: {
        start: null,
        end: null
    }
};

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    if (!window.auth.isAuthenticated()) {
        window.location.href = '/login.html';
        return;
    }
    initializeDashboard();
    setupEventListeners();
    setupSearch();
    setupRecurringTaskFields();
    startTotalHoursUpdate();
});

function initializeDashboard() {
    // Load initial data
    loadUserStats();
    loadTasks();
    loadProjects();
    updateDailyTime();
    
    // Show "no task selected" state by default
    selectTask(null);
    
    // Start updating daily time every minute
    dailyUpdateInterval = setInterval(updateDailyTime, 60000);
}

// Update timer update listener to handle accumulated time
window.electronAPI.onTimerUpdate((data) => {
    if (isTracking) {
        // Get existing time logged for task display
        let existingSeconds = 0;
        if (selectedTask.timing?.timeLogged) {
            const timeMatch = selectedTask.timing.timeLogged.match(/(\d+)h\s*(\d+)m/);
            if (timeMatch) {
                const hours = parseInt(timeMatch[1]) || 0;
                const minutes = parseInt(timeMatch[2]) || 0;
                existingSeconds = (hours * 3600) + (minutes * 60);
            }
        }
        
        // Update elapsed time with current session time plus existing time for task display
        elapsedSeconds = existingSeconds + data.seconds;
        updateElapsedTimeDisplay();
        
        // Update the time logged column in real-time
        const taskRow = document.querySelector(`[data-task-id="${selectedTask.taskId}"]`);
        if (taskRow) {
            const timeLoggedElement = taskRow.querySelector('.time-logged');
            if (timeLoggedElement) {
                const hours = Math.floor(elapsedSeconds / 3600);
                const minutes = Math.floor((elapsedSeconds % 3600) / 60);
                timeLoggedElement.textContent = `${hours}h ${minutes}m`;
            }
        }
        
        // Update total hours today using only the current session time
        updateTotalHoursToday(data.seconds);
    }
});

// Update the updateTotalHoursToday function to use current session time
async function updateTotalHoursToday(currentSessionSeconds = 0) {
    try {
        const userId = window.auth.getUserId();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Fetch today's daily time entry
        const response = await fetch(`${config.API_BASE_URL}/api/daily-time/${userId}`, {
            headers: {
                'Authorization': `Bearer ${window.auth.getToken()}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to load daily time');
        }

        const dailyTime = await response.json();
        let totalSecondsToday = dailyTime.totalSeconds || 0;

        // Add current tracking session if active
        if (isTracking && currentSessionSeconds) {
            totalSecondsToday += currentSessionSeconds;
        }

        // Convert total seconds to HH:MM:SS format
        const hours = Math.floor(totalSecondsToday / 3600);
        const minutes = Math.floor((totalSecondsToday % 3600) / 60);
        const seconds = totalSecondsToday % 60;

        // Update the display
        const timerDisplay = document.querySelector('.timer-display');
        timerDisplay.textContent = formatTime(hours, minutes, seconds);

        // Check if we need to reset at midnight
        const now = new Date();
        const timeUntilMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;
        
        // Set timeout to reset at midnight
        setTimeout(() => {
            timerDisplay.textContent = '00:00:00';
            // Recursively call to start the next day
            updateTotalHoursToday();
        }, timeUntilMidnight);

    } catch (error) {
        console.error('Error updating total hours today:', error);
        const timerDisplay = document.querySelector('.timer-display');
        timerDisplay.textContent = '00:00:00';
    }
}

// Function to start updating total hours
function startTotalHoursUpdate() {
    // Update immediately
    updateTotalHoursToday();
    // Set timeout for midnight reset
    const now = new Date();
    const timeUntilMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;
    setTimeout(() => {
        updateTotalHoursToday();
        startTotalHoursUpdate(); // Restart for the next day
    }, timeUntilMidnight);
}

// Clean up interval on page unload
window.addEventListener('beforeunload', async (event) => {
    // Clear intervals
    if (totalHoursInterval) {
        clearInterval(totalHoursInterval);
    }

    if (isTracking) {
        // Cancel the default close behavior
        event.preventDefault();
        // Chrome requires returnValue to be set
        event.returnValue = '';

        try {
            // Show confirmation dialog using electron
            const choice = await window.electronAPI.showCloseConfirmation();
            
            if (choice) {
                // User clicked Yes, stop the timer and save data
                await stopTimer();
                // Send close command to main process
                await window.electronAPI.closeWindow();
            }
            // If user clicked No, prevent closing
            event.preventDefault();
            event.returnValue = '';
        } catch (error) {
            console.error('Error during close:', error);
            // If there's an error, prevent closing
            event.preventDefault();
            event.returnValue = '';
        }
    } else {
        // No timer running, close normally
        await window.electronAPI.closeWindow();
    }
});

function setupEventListeners() {
    // Modal controls
    addTaskBtn.addEventListener('click', openModal);
    closeModalBtn.addEventListener('click', closeModal);
    
    // Timer controls
    playButton.addEventListener('click', (event) => toggleTimer(event));
    completeTaskBtn.addEventListener('click', completeTask);
    
    // Form submission
    document.getElementById('add-task-form').addEventListener('submit', handleTaskSubmit);

    // Project selection
    projectSelect.addEventListener('change', handleProjectChange);

    // Recurring task fields
    setupRecurringTaskFields();

    // Add time period select listener
    const timePeriodSelect = document.getElementById('timePeriodSelect');
    if (timePeriodSelect) {
        timePeriodSelect.addEventListener('change', (e) => {
            selectedTimePeriod = parseInt(e.target.value);
            loadUserStats(); // Reload stats with new time period
        });
    }

    // Filter modal controls
    const filterIcon = document.getElementById('filter-icon');
    const filterModal = document.getElementById('filter-modal');
    const filterOverlay = document.getElementById('filter-overlay');
    const closeFilterBtn = document.querySelector('.close-filter');
    const cancelFilterBtn = document.getElementById('cancel-filter');
    const clearFilterBtn = document.getElementById('clear-filter');
    const applyFilterBtn = document.getElementById('apply-filter');

    filterIcon.addEventListener('click', openFilterModal);
    closeFilterBtn.addEventListener('click', closeFilterModal);
    cancelFilterBtn.addEventListener('click', closeFilterModal);
    clearFilterBtn.addEventListener('click', clearFilters);
    applyFilterBtn.addEventListener('click', applyFilters);
    filterOverlay.addEventListener('click', (e) => {
        if (e.target === filterOverlay) {
            closeFilterModal();
        }
    });

    // Filter options click handlers
    document.querySelectorAll('.filter-option').forEach(option => {
        option.addEventListener('click', (e) => {
            const checkbox = option.querySelector('input[type="checkbox"]');
            if (e.target !== checkbox) {
                checkbox.checked = !checkbox.checked;
            }
            option.classList.toggle('selected', checkbox.checked);
        });
    });
}

// Project Functions
async function loadProjects() {
    try {
        const response = await fetch('https://actracker.onrender.com/projects', {
            headers: {
                'Authorization': `Bearer ${window.auth.getToken()}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to load projects');
        }

        const projects = await response.json();
        populateProjectSelect(projects);
        return projects;
    } catch (error) {
        console.error('Error loading projects:', error);
        throw error;
    }
}

function populateProjectSelect(projects) {
    // Clear existing options except the default one
    projectSelect.innerHTML = '<option value="">Select project</option>';
    
    // Add projects to select dropdown
    projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project._id;
        option.textContent = project.projectName;
        projectSelect.appendChild(option);
    });

    // If there was a previously selected project, restore it
    if (currentProject) {
        projectSelect.value = currentProject._id;
    }
}

function handleProjectChange(e) {
    const selectedProjectId = e.target.value;
    const selectedProject = Array.from(e.target.options).find(option => option.value === selectedProjectId);
    
    if (selectedProjectId && selectedProject) {
        currentProject = {
            _id: selectedProjectId,
            projectName: selectedProject.textContent
        };
        
        // Update project info display
        projectInfo.innerHTML = `
            <p class="project-name">${selectedProject.textContent}</p>
            <p class="no-task">No Task Selected</p>
        `;
    } else {
        currentProject = null;
        projectInfo.innerHTML = `
            <p class="no-project">No Project Selected</p>
            <p class="no-task">No Task Selected</p>
        `;
    }

    // If tracking is active, update the current session
    if (isTracking) {
        updateTrackingSession();
    }
}

async function updateTrackingSession() {
    if (!currentProject) return;

    try {
        const userId = window.auth.getUserId();
        
        // Pause current tracking
        await window.electronAPI.pauseTrackingBrowserActivity();
        
        // Resume with new project
        await window.electronAPI.startTrackingBrowserActivity(userId, currentProject._id);
    } catch (error) {
        console.error('Error updating tracking session:', error);
    }
}

// Modal Functions
function openModal() {
    const overlay = document.getElementById('modal-overlay');
    modal.classList.add('active');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden'; // Prevent scrolling of background
}

function closeModal() {
    const overlay = document.getElementById('modal-overlay');
    modal.classList.remove('active');
    overlay.classList.remove('active');
    document.body.style.overflow = ''; // Restore scrolling
}

// Add click handler for overlay to close modal when clicking outside
document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeModal();
            }
        });
    }
});

// Timer Functions
function toggleTimer(event) {
    // Prevent event bubbling
    event.stopPropagation();
    
    if (!selectedTask) {
        displayNotification('Please select a task first', 'error');
        return;
    }

    // Check if task is completed
    if (selectedTask.status === 'Completed') {
        displayNotification('Cannot track time for completed tasks', 'warning');
        return;
    }

    if (!isTracking) {
        startTimer();
    } else {
        stopTimer();
    }
}

async function startTimer() {
    if (!selectedTask) {
        displayNotification('Please select a task first', 'error');
        return;
    }

    // Double check task status before starting timer
    if (selectedTask.status === 'Completed') {
        displayNotification('Cannot track time for completed tasks', 'warning');
        return;
    }

    try {
        isTracking = true;
        playButton.innerHTML = '<i class="fas fa-stop"></i>';
        
        // Get existing time logged and convert to seconds
        let existingSeconds = 0;
        if (selectedTask.timing?.timeLogged) {
            const timeMatch = selectedTask.timing.timeLogged.match(/(\d+)h\s*(\d+)m/);
            if (timeMatch) {
                const hours = parseInt(timeMatch[1]) || 0;
                const minutes = parseInt(timeMatch[2]) || 0;
                existingSeconds = (hours * 3600) + (minutes * 60);
            }
        }
        
        // Start from existing elapsed time
        elapsedSeconds = existingSeconds;
        updateElapsedTimeDisplay();
        
        // Start electron tracking
        const userId = window.auth.getUserId();
        const projectId = selectedTask.project.projectId;
        
        // Update task status to "In Progress" if it's "Not Started"
        if (selectedTask.status === 'Not Started') {
            const taskResponse = await fetch(`${config.API_BASE_URL}/api/tasks/${selectedTask.taskId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${window.auth.getToken()}`
                },
                body: JSON.stringify({
                    status: 'In Progress'
                })
            });

            if (taskResponse.ok) {
                selectedTask.status = 'In Progress';
                updateTaskInArrays(selectedTask);
            }
        }
        
        // Start tracking browser activity
        window.electronAPI.startTrackingBrowserActivity(userId, projectId);
        
    } catch (error) {
        console.error('Error starting timer:', error);
        displayNotification('Failed to start timer: ' + error.message, 'error');
        isTracking = false;
        playButton.innerHTML = '<i class="fas fa-play"></i>';
    }
}

// Add this new function to update elapsed time display
function updateElapsedTimeDisplay() {
    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = elapsedSeconds % 60;
    elapsedTime.textContent = formatTime(hours, minutes, seconds);
}

async function stopTimer() {
    if (!isTracking || !selectedTask) return;

    try {
        const userId = window.auth.getUserId();
        const projectId = selectedTask.project.projectId;
        
        // Stop tracking in electron
        await window.electronAPI.stopTrackingBrowserActivity(userId, projectId, elapsedSeconds);
        
        // Calculate total time logged
        const hours = Math.floor(elapsedSeconds / 3600);
        const minutes = Math.floor((elapsedSeconds % 3600) / 60);
        const timeLogged = `${hours}h ${minutes}m`;
        
        // Calculate new worked hours
        const existingWorked = selectedTask.timing?.worked || 0;
        const newWorkedHours = existingWorked + (elapsedSeconds / 3600);
        
        // Update task in database with accumulated time
        const taskResponse = await fetch(`${config.API_BASE_URL}/api/tasks/${selectedTask.taskId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.auth.getToken()}`
            },
            body: JSON.stringify({
                userId: userId,
                timing: {
                    ...selectedTask.timing,
                    worked: newWorkedHours,
                    timeLogged: timeLogged
                }
            })
        });

        if (!taskResponse.ok) {
            throw new Error('Failed to update task time');
        }

        // Update daily time with total elapsed time
        await updateDailyTime(
            selectedTask.taskId,
            elapsedSeconds,
            selectedTask.title,
            selectedTask.project.projectName
        );
        
        // Update local task data
        selectedTask.timing = {
            ...selectedTask.timing,
            timeLogged: timeLogged,
            worked: newWorkedHours
        };
        
        // Update task in arrays and re-render
        updateTaskInArrays(selectedTask);
        
        // Reset timer state but keep the accumulated time
        isTracking = false;
        playButton.innerHTML = '<i class="fas fa-play"></i>';
        
        // Update UI
        updateProjectInfo(selectedTask);
        await loadUserStats();
        displayNotification('Timer stopped successfully', 'success');
        
    } catch (error) {
        console.error('Error stopping timer:', error);
        displayNotification('Failed to stop timer: ' + error.message, 'error');
        
        // Reset timer state
        isTracking = false;
        playButton.innerHTML = '<i class="fas fa-play"></i>';
    }
}

// Add helper function to update task in arrays
function updateTaskInArrays(task) {
    const taskIndex = allTasks.findIndex(t => t.taskId === task.taskId);
    if (taskIndex !== -1) {
        allTasks[taskIndex] = {...task};
        const filteredIndex = filteredTasks.findIndex(t => t.taskId === task.taskId);
        if (filteredIndex !== -1) {
            filteredTasks[filteredIndex] = {...task};
        }
        renderTasks(filteredTasks.length ? filteredTasks : allTasks);
    }
}

// Task Functions
async function handleTaskSubmit(e) {
    e.preventDefault();
    
    try {
        clearMessages();
        
        // Basic validation
        const requiredFields = ['task-title', 'project', 'startDate', 'dueDate', 'task-status'];
        let hasErrors = false;
        
        requiredFields.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (!field.value.trim()) {
                highlightField(fieldId);
                hasErrors = true;
            }
        });
        
        // Validate recurring task fields if enabled
        const isRecurring = document.getElementById('recurring-toggle').checked;
        if (isRecurring) {
            const untilDate = document.getElementById('until-date').value;
            const selectedDays = document.querySelectorAll('input[name="days"]:checked');
            
            if (!untilDate) {
                highlightField('until-date');
                hasErrors = true;
            }
            
            if (selectedDays.length === 0) {
                displayNotification('Please select at least one day for recurring task', 'error');
                hasErrors = true;
            }
        }
        
        if (hasErrors) {
            displayNotification('Please fill in all required fields', 'error');
            return;
        }
        
        const formData = new FormData(e.target);
        const userId = window.auth.getUserId();
        
        // Get selected days only if recurring is enabled
        const selectedDays = isRecurring ? 
            Array.from(document.querySelectorAll('input[name="days"]:checked'))
                .map(checkbox => checkbox.value) : [];
        
        // Store values that should be kept for Save & Add Another
        const projectValue = formData.get('project');
        const sprintValue = formData.get('sprint');
        const epicValue = formData.get('epic');
        
        // Get project name from select element
        const projectSelect = document.getElementById('project');
        const selectedProjectName = projectSelect.options[projectSelect.selectedIndex]?.text || 'No Project';

        // Get sprint and epic names from select elements
        const sprintSelect = document.getElementById('sprint');
        const epicSelect = document.getElementById('epic');
        const selectedSprintName = sprintSelect.options[sprintSelect.selectedIndex]?.text || '';
        const selectedEpicName = epicSelect.options[epicSelect.selectedIndex]?.text || '';

        // Parse dates and ensure they're in ISO format
        const startDate = formData.get('startDate') ? new Date(formData.get('startDate')).toISOString() : null;
        const dueDate = formData.get('dueDate') ? new Date(formData.get('dueDate')).toISOString() : null;
        const untilDate = isRecurring && formData.get('until-date') ? 
            new Date(formData.get('until-date')).toISOString() : null;

        // Parse numeric values
        const estimate = formData.get('estimate') ? Number(formData.get('estimate')) : 0;
        const worked = formData.get('worked') ? Number(formData.get('worked')) : 0;
        
        // Create task schema
        const taskData = {
            taskId: `task_${Date.now()}`,
            userId: userId,
            projectId: projectValue || null,
            title: formData.get('task-title') || null,
            description: formData.get('description') || null,
            status: formData.get('task-status') || 'Not Started',
            priority: 'High',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metadata: {
                sprint: sprintValue || null,
                sprintName: selectedSprintName,
                epic: epicValue || null,
                epicName: selectedEpicName,
                labels: [],
                dependencies: [],
                attachments: []
            },
            timing: {
                startDate: startDate,
                dueDate: dueDate,
                estimate: estimate,
                worked: worked,
                timeLogged: '0 Hours'
            },
            recurring: {
                isRecurring: isRecurring,
                untilDate: untilDate,
                days: selectedDays
            },
            assignee: {
                userId: formData.get('assignee') || userId,
                assignedAt: new Date().toISOString()
            },
            project: {
                projectId: projectValue || null,
                projectName: selectedProjectName
            }
        };

        console.log('Sending task data:', taskData);

        const response = await fetch('https://actracker.onrender.com/api/tasks/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.auth.getToken()}`
            },
            body: JSON.stringify(taskData)
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || data.error || 'Failed to create task');
        }
        
        displayNotification('Task created successfully!', 'success');
        await loadTasks();

        // Handle Save & Add Another
        const submitButton = e.submitter;
        const isSaveAndAdd = submitButton.value === 'saveAndAdd';
        
        if (isSaveAndAdd) {
            e.target.reset();
            if (projectValue) document.getElementById('project').value = projectValue;
            if (sprintValue) document.getElementById('sprint').value = sprintValue;
            if (epicValue) document.getElementById('epic').value = epicValue;
            document.getElementById('task-title').focus();
        } else {
            e.target.reset();
            closeModal();
        }
        
    } catch (error) {
        displayNotification(error.message || 'Failed to create task. Please try again.', 'error');
    }
}

function createNotificationContainer() {
    let container = document.querySelector('.notification-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'notification-container';
        document.body.appendChild(container);
    }
    return container;
}

function displayNotification(message, type = 'info') {
    const container = createNotificationContainer();
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    
    // Add icon based on type
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-icon">${icon}</span>
            <span class="notification-message">${message}</span>
        </div>
        <button class="notification-close">✕</button>
    `;
    
    // Add to container
    container.appendChild(notification);
    
    // Add close button functionality
    const closeBtn = notification.querySelector('.notification-close');
    closeBtn.onclick = () => {
        notification.classList.add('notification-hiding');
        setTimeout(() => notification.remove(), 300);
    };
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        if (notification.parentElement) {
            notification.classList.add('notification-hiding');
            setTimeout(() => notification.remove(), 300);
        }
    }, 5000);
}

// Add notification styles immediately when the script loads
const notificationStyles = `
    .notification-container {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
    }

    .notification {
        background: white;
        border-radius: 8px;
        padding: 16px;
        min-width: 300px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        animation: slideIn 0.3s ease-out;
        pointer-events: auto;
    }

    .notification-content {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .notification-icon {
        font-size: 20px;
    }

    .notification-message {
        font-size: 14px;
        font-weight: 500;
        color: #333;
    }

    .notification-close {
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px;
        opacity: 0.6;
        transition: opacity 0.2s;
        color: #333;
    }

    .notification-close:hover {
        opacity: 1;
    }

    .notification-success {
        border-left: 4px solid #48BB78;
    }

    .notification-error {
        border-left: 4px solid #F56565;
    }

    .notification-info {
        border-left: 4px solid #4299E1;
    }

    .notification-success .notification-icon {
        color: #48BB78;
    }

    .notification-error .notification-icon {
        color: #F56565;
    }

    .notification-info .notification-icon {
        color: #4299E1;
    }

    .notification-hiding {
        animation: slideOut 0.3s ease-in forwards;
    }

    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }

    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;

// Add styles to document immediately
(function() {
    const styleElement = document.createElement('style');
    styleElement.textContent = notificationStyles;
    document.head.appendChild(styleElement);
})();

function clearFormErrors() {
    // Remove error classes from all form fields
    document.querySelectorAll('.form-group').forEach(group => {
        group.classList.remove('has-error');
        const errorMessage = group.querySelector('.error-message');
        if (errorMessage) {
            errorMessage.remove();
        }
    });
}

function highlightField(fieldName) {
    const field = document.getElementById(fieldName);
    if (!field) return;
    
    const formGroup = field.closest('.form-group');
    if (!formGroup) return;
    
    formGroup.classList.add('has-error');
    
    // Add error message
    const errorMessage = document.createElement('div');
    errorMessage.className = 'error-message';
    errorMessage.textContent = 'This field is required';
    formGroup.appendChild(errorMessage);
}

// Add the validation styles to the document
const validationStyles = `
    .form-group.has-error input,
    .form-group.has-error select,
    .form-group.has-error textarea {
        border-color: var(--danger-color);
        background-color: rgba(255, 118, 117, 0.1);
    }
    
    .error-message {
        color: var(--danger-color);
        font-size: 0.8em;
        margin-top: 4px;
        animation: fadeIn 0.3s ease-in;
    }
    
    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(-5px); }
        to { opacity: 1; transform: translateY(0); }
    }
    
    /* Add required field indicator */
    .form-group.required label::after {
        content: "*";
        color: var(--danger-color);
        margin-left: 4px;
    }
`;

// Create and append the validation styles
const validationStyleElement = document.createElement('style');
validationStyleElement.textContent = validationStyles;
document.head.appendChild(validationStyleElement);

// Add required class to required form groups
document.addEventListener('DOMContentLoaded', () => {
    // Add required indicators
    const requiredFields = ['task-title', 'project', 'due-date'];
    requiredFields.forEach(fieldId => {
        const formGroup = document.getElementById(fieldId)?.closest('.form-group');
        if (formGroup) {
            formGroup.classList.add('required');
        }
    });
});

async function loadTasks() {
    try {
        const userId = window.auth.getUserId();
        const response = await fetch(`https://actracker.onrender.com/api/tasks/${userId}`, {
            headers: {
                'Authorization': `Bearer ${window.auth.getToken()}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to load tasks');
        }
        
        allTasks = await response.json();
        filteredTasks = [...allTasks];
        renderTasks(filteredTasks);
        
        // Update total tasks count in stats
        document.querySelector('.stat-card:nth-child(4) p').textContent = allTasks.length;
        
    } catch (error) {
        console.error('Error loading tasks:', error);
        displayNotification('Failed to load tasks', 'error');
    }
}

// Update the calculatePriority function
function calculatePriority(dueDate) {
    if (!dueDate) return 'Low';
    
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Set to start of day for accurate comparison
    const deadline = new Date(dueDate);
    deadline.setHours(0, 0, 0, 0);
    const daysUntilDue = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
    
    if (daysUntilDue < 0) return 'Overdue';
    if (daysUntilDue <= 2) return 'High';
    if (daysUntilDue <= 7) return 'Medium';
    return 'Low';
}

// Update the renderTasks function to include priority calculation
function renderTasks(tasks) {
    const tableBody = document.querySelector('.table-body');
    const emptyState = document.querySelector('.empty-state');
    
    if (!tableBody) {
        console.error('Table body element not found');
        return;
    }
    
    if (!tasks || tasks.length === 0) {
        tableBody.innerHTML = '';
        if (emptyState) {
            emptyState.style.display = 'flex';
        }
        return;
    }
    
    if (emptyState) {
        emptyState.style.display = 'none';
    }
    
    const startIndex = (currentPage - 1) * tasksPerPage;
    const endIndex = startIndex + tasksPerPage;
    const paginatedTasks = tasks.slice(startIndex, endIndex);
    
    tableBody.innerHTML = paginatedTasks.map(task => {
        // Format time logged
        let timeLogged = '0h 0m';
        if (task.timing && task.timing.timeLogged) {
            timeLogged = task.timing.timeLogged;
        }

        // Calculate current priority based on deadline
        const currentPriority = calculatePriority(task.timing?.dueDate);

        return `
            <div class="task-row ${selectedTask && selectedTask.taskId === task.taskId ? 'selected' : ''}" 
                 data-task-id="${task.taskId}" 
                 onclick="selectTask(${JSON.stringify(task).replace(/"/g, '&quot;')})">
                <div class="task-title">${task.title || 'Untitled Task'}</div>
                <div class="project-name">${task.project?.projectName || 'No Project'}</div>
                <div class="deadline">${formatDate(task.timing?.dueDate)}</div>
                <div class="priority-badge priority-${currentPriority.toLowerCase()}">${currentPriority}</div>
                <div class="time-logged">${timeLogged}</div>
                <div class="status">
                    <span class="status-badge ${getStatusClass(task.status)}">${task.status || 'Not Started'}</span>
                </div>
            </div>
        `;
    }).join('');
    
    updatePagination(tasks.length);
}

function getStatusClass(status) {
    const statusMap = {
        'Completed': 'status-completed',
        'Not Started': 'status-not-started',
        'In Progress': 'status-in-progress',
        'Blocked': 'status-blocked'
    };
    return statusMap[status] || 'status-not-started';
}

function selectTask(task) {
    // If timer is running, don't allow task switching
    if (isTracking) {
        displayNotification('Please stop the current timer before switching tasks', 'warning');
        return;
    }

    // Remove selection from previously selected task
    const previouslySelected = document.querySelector('.task-row.selected');
    if (previouslySelected) {
        previouslySelected.classList.remove('selected');
    }

    selectedTask = task;
    
    if (task) {
        // Add selection to newly selected task
        const taskRow = document.querySelector(`[data-task-id="${task.taskId}"]`);
        if (taskRow) {
            taskRow.classList.add('selected');
        }

        // Get existing time logged and update elapsed time display
        let existingSeconds = 0;
        if (task.timing?.timeLogged) {
            const timeMatch = task.timing.timeLogged.match(/(\d+)h\s*(\d+)m/);
            if (timeMatch) {
                const hours = parseInt(timeMatch[1]) || 0;
                const minutes = parseInt(timeMatch[2]) || 0;
                existingSeconds = (hours * 3600) + (minutes * 60);
            }
        }
        
        // Update elapsed time display with existing time
        elapsedSeconds = existingSeconds;
        updateElapsedTimeDisplay();

        // Update project info display with task details
        updateProjectInfo(task);
        
        // Show complete task button
        completeTaskBtn.style.display = 'block';
    } else {
        // Reset elapsed time display when no task is selected
        elapsedSeconds = 0;
        updateElapsedTimeDisplay();

        // Show the SVG and default message when no task is selected
        projectInfo.innerHTML = `
            <div class="no-task-container">
                <svg width="183" height="184" viewBox="0 0 183 184" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M125.9 101C128.164 101 130 99.1644 130 96.9C130 94.6356 128.164 92.8 125.9 92.8C123.635 92.8 121.8 94.6356 121.8 96.9C121.8 99.1644 123.635 101 125.9 101Z" fill="#EAEEF9"/>
                    <path d="M118.027 112.439C119.573 112.439 120.827 111.186 120.827 109.639C120.827 108.093 119.573 106.839 118.027 106.839C116.48 106.839 115.227 108.093 115.227 109.639C115.227 111.186 116.48 112.439 118.027 112.439Z" fill="#EAEEF9"/>
                    <path d="M27.3 44C28.8464 44 30.1 42.7464 30.1 41.2C30.1 39.6536 28.8464 38.4 27.3 38.4C25.7536 38.4 24.5 39.6536 24.5 41.2C24.5 42.7464 25.7536 44 27.3 44Z" fill="#EAEEF9"/>
                    <path d="M10.2 98C13.0719 98 15.4 95.6719 15.4 92.8C15.4 89.9281 13.0719 87.6 10.2 87.6C7.32812 87.6 5 89.9281 5 92.8C5 95.6719 7.32812 98 10.2 98Z" fill="#EAEEF9"/>
                    <path d="M73.3499 124.1C101.35 124.1 124.05 101.4 124.05 73.3C124.05 45.2 101.35 22.5 73.3499 22.5C45.3499 22.5 22.6499 45.2 22.6499 73.3C22.6499 101.4 45.3499 124.1 73.3499 124.1Z" fill="#EAEEF9"/>
                    <path d="M129.733 37.9021C131.636 37.9021 133.247 39.3589 133.247 41.3985V144.543C133.247 146.437 131.783 148.039 129.733 148.039H53.4556C51.5524 148.039 49.9419 146.583 49.9419 144.543V41.3985C49.9419 39.5046 51.4059 37.9021 53.4556 37.9021H129.733Z" fill="#CED7E2"/>
                    <path d="M133.247 48.6827V144.397C133.247 146.291 131.783 147.894 129.733 147.894H60.044L53.895 141.775L123.145 46.9345L129.147 44.7492L133.247 48.6827Z" fill="#BCC4CF"/>
                    <path d="M129.44 45.9147C129.44 45.332 129.001 44.7492 128.269 44.7492H55.0663C54.4806 44.7492 53.895 45.1863 53.895 45.9147V140.609C53.895 141.192 54.3342 141.775 55.0663 141.775H128.123C128.708 141.775 129.294 141.338 129.294 140.609L129.44 45.9147Z" fill="#D9DFEE"/>
                    <path d="M129.44 45.9147C129.44 45.332 129.001 44.7492 128.269 44.7492H55.0661C54.4805 44.7492 53.8949 45.1863 53.8949 45.9147C54.7733 83.6469 55.0661 126.332 50.9668 137.404L121.095 136.385C125.341 117.154 128.562 82.6271 129.44 45.9147Z" fill="#EFF3FB"/>
                    <g filter="url(#filter0_d_1340_22095)">
                    <path d="M129.293 44.8949C129.293 44.8949 129.147 50.5766 127.39 86.852C127.39 87.1433 127.39 87.289 127.39 87.5804C125.194 123.127 93.5703 130.557 89.7638 130.994C88.0069 131.14 84.6396 131.431 78.637 131.431C71.1703 131.723 59.7507 131.868 41.8892 132.014C41.3036 132.014 40.8644 131.431 41.1572 130.849C53.4552 106.228 53.6016 45.0406 53.6016 45.0406L129.293 44.8949Z" fill="white"/>
                    </g>
                    <path d="M127.244 87.4347C125.194 122.982 93.4241 130.412 89.6175 130.849C87.8607 130.994 84.4933 131.286 78.4907 131.286C94.3025 124.001 102.794 110.89 102.648 100.692C110.261 101.275 123.437 100.692 127.244 87.4347Z" fill="#EAEEF9"/>
                    <path d="M109.382 38.1934C109.382 38.0477 109.382 38.0477 109.382 38.1934L108.65 37.465C108.65 37.465 108.211 37.6107 108.065 37.9021H96.6451C96.6451 37.6107 96.6451 37.465 96.6451 37.1736C96.6451 34.8427 94.5954 32.8031 92.2529 32.8031C89.9104 32.8031 87.8607 34.8427 87.8607 37.1736C87.8607 37.465 87.8607 37.6107 88.0071 37.7564H76.1483C75.5627 37.7564 74.9771 38.1934 74.9771 39.0675V42.8553C74.9771 45.769 77.0267 47.5172 79.8084 47.5172H104.112C107.04 47.5172 109.529 45.769 109.529 42.8553V38.9219C109.675 38.6305 109.529 38.3391 109.382 38.1934Z" fill="#1C3754"/>
                    <path d="M108.943 38.1934V41.9812C108.943 42.2726 108.943 42.4183 108.943 42.7097C108.504 45.1863 106.454 47.2259 103.819 47.2259H79.3693C76.734 47.2259 74.6843 45.1863 74.2451 42.7097C74.2451 42.4183 74.2451 42.2726 74.2451 41.9812V38.1934C74.2451 37.6107 74.6843 36.8823 75.4164 36.8823H87.4216C87.4216 36.5909 87.4216 36.4452 87.4216 36.2995C87.4216 33.9686 89.4713 31.929 91.8138 31.929C94.1563 31.929 96.2059 33.9686 96.2059 36.2995C96.2059 36.5909 96.2059 36.7366 96.2059 36.8823H108.211C108.504 37.028 108.943 37.465 108.943 38.1934Z" fill="url(#paint0_linear_1340_22095)"/>
                    <path d="M91.5209 38.3391C92.6921 38.3391 93.5705 37.465 93.5705 36.2995C93.5705 35.1341 92.6921 34.26 91.5209 34.26C90.3496 34.26 89.4712 35.1341 89.4712 36.2995C89.4712 37.465 90.496 38.3391 91.5209 38.3391Z" fill="#EAEEF9"/>
                    <path d="M108.797 42.7097C108.358 45.1863 106.308 47.2259 103.673 47.2259H79.3693C76.734 47.2259 74.6843 45.1863 74.2451 42.7097H108.797Z" fill="#9AA1B2"/>
                    <path d="M71.9027 86.9977C74.2452 86.9977 76.002 85.1038 76.002 82.9185C76.002 80.5875 74.0988 78.8393 71.9027 78.8393C69.5602 78.8393 67.8033 80.7332 67.8033 82.9185C67.6569 85.1038 69.5602 86.9977 71.9027 86.9977Z" fill="#989FB0"/>
                    <path d="M104.405 86.852C106.747 86.852 108.504 84.9581 108.504 82.7728C108.504 80.4419 106.601 78.6937 104.405 78.6937C102.208 78.6937 100.305 80.5876 100.305 82.7728C100.305 84.9581 102.062 86.852 104.405 86.852Z" fill="#989FB0"/>
                    <path d="M92.1066 91.3682H84.2007V93.2621H92.1066V91.3682Z" fill="#989FB0"/>
                    <path d="M171.019 45.332C174.24 60.4831 173.801 76.5084 169.409 91.3682C168.384 94.4276 167.359 97.7783 165.163 100.109C162.088 103.751 156.525 105.354 151.986 104.188C147.301 103.023 143.495 98.9438 142.616 93.9905C141.884 90.9311 142.909 87.289 145.544 85.3951C148.326 83.6469 152.279 84.084 154.622 86.2692C157.257 88.4545 158.282 91.8052 158.135 95.0103C157.989 98.2154 156.818 101.42 155.207 104.188C150.376 113.221 141.592 120.359 131.49 123.564C124.023 125.895 115.971 125.895 108.504 123.856" stroke="#C9D4E2" stroke-width="2" stroke-miterlimit="10" stroke-dasharray="4 4"/>
                    <path d="M177.168 40.9614C176.729 42.564 174.972 43.1467 173.215 42.1269C171.312 41.2528 169.995 40.5244 170.287 39.0675C170.727 37.6107 172.483 37.465 174.533 37.3193C177.022 37.028 177.461 39.3589 177.168 40.9614Z" fill="#DAE2EB"/>
                    <path d="M162.967 42.4183C163.699 43.7294 165.749 44.6035 167.213 43.2924C168.823 41.8355 170.141 40.8158 169.409 39.3589C168.677 38.0478 167.506 38.4848 165.017 38.7762C162.967 39.2132 162.089 40.9614 162.967 42.4183Z" fill="#DAE2EB"/>
                    <path d="M169.409 37.028C170.434 36.8823 171.458 37.465 171.751 38.3391C171.898 38.6305 172.044 39.0675 172.044 39.3589C172.337 41.3985 171.605 43.1467 170.434 43.2924C169.116 43.5838 167.798 42.1269 167.652 40.233C167.652 39.6503 167.652 39.3589 167.652 38.9219C167.798 37.9021 168.384 37.1736 169.409 37.028C169.555 37.028 169.409 37.028 169.409 37.028Z" fill="#989FB0"/>
                    <defs>
                    <filter id="filter0_d_1340_22095" x="19.064" y="33.8949" width="132.229" height="131.119" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
                    <feFlood flood-opacity="0" result="BackgroundImageFix"/>
                    <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
                    <feOffset dy="11"/>
                    <feGaussianBlur stdDeviation="11"/>
                    <feColorMatrix type="matrix" values="0 0 0 0 0.397708 0 0 0 0 0.47749 0 0 0 0 0.575 0 0 0 0.27 0"/>
                    <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1340_22095"/>
                    <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_1340_22095" result="shape"/>
                    </filter>
                    <linearGradient id="paint0_linear_1340_22095" x1="74.287" y1="39.5793" x2="108.977" y2="39.5793" gradientUnits="userSpaceOnUse">
                    <stop stop-color="#B0BACC"/>
                    <stop offset="1" stop-color="#969EAE"/>
                    </linearGradient>
                    </defs>
                </svg>
                <p class="no-task">No Task Selected!</p>
                <p class="no-task-message">Please select task to start track ur time</p>
            </div>
        `;
        completeTaskBtn.style.display = 'none';
    }
}

function updateProjectInfo(task) {
    if (!task) {
        // Show the SVG when no task is selected
        projectInfo.innerHTML = `
            <div class="no-task-container">
                <svg width="183" height="184" viewBox="0 0 183 184" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <!-- SVG content same as above -->
                </svg>
                <p class="no-task">No Task Selected!</p>
                <p class="no-task-message">Please select task to start track ur time</p>
            </div>
        `;
        return;
    }
    
    // Show task details when a task is selected (without time logged)
    const formattedDate = task.timing?.dueDate ? formatDate(task.timing.dueDate) : 'No date';
    
    projectInfo.innerHTML = `
        <div class="selected-task-info">
            <p class="project-name">${task.project?.projectName || 'No Project'}</p>
            <p class="task-name">${task.title}</p>
            <div class="task-meta">
                <span class="due-date">Due: ${formattedDate}</span>
                <span class="priority">Priority: ${task.priority}</span>
                <span class="status">Status: ${task.status}</span>
            </div>
            <div class="task-details">
                <p class="task-description">${task.description || 'No description'}</p>
            </div>
        </div>
    `;
}

async function loadUserStats() {
    try {
        const userId = window.auth.getUserId();
        
        // Fetch daily time entries for the selected period
        const response = await fetch(`https://actracker.onrender.com/api/daily-time/all/${userId}?period=${selectedTimePeriod}`, {
            headers: {
                'Authorization': `Bearer ${window.auth.getToken()}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to load user stats');
        }
        
        const dailyTimes = await response.json();
        
        // Calculate total seconds from all daily time entries
        const totalSeconds = dailyTimes.reduce((total, entry) => total + entry.totalSeconds, 0);
        
        // Convert total seconds to hours, minutes, seconds
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        
        // Format the time string
        const formattedTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        
        // Update the stats display
        document.querySelector('.stat-card:nth-child(1) p').textContent = formattedTime;
        
        // Calculate earnings if hourly rate is available
        const hourlyRate = 20; // This should come from user settings
        const totalHours = totalSeconds / 3600;
        const earnings = (totalHours * hourlyRate).toFixed(2);
        document.querySelector('.stat-card:nth-child(2) p').textContent = `$${earnings}`;
        
        // Update unit price
        document.querySelector('.stat-card:nth-child(3) p').textContent = `$${hourlyRate}`;
        
        // Update total tasks count for the period
        const uniqueTasks = new Set(dailyTimes.flatMap(entry => entry.tasks.map(task => task.taskId))).size;
        document.querySelector('.stat-card:nth-child(4) p').textContent = uniqueTasks.toString();
        
    } catch (error) {
        console.error('Error loading user stats:', error);
        displayNotification('Failed to load user statistics', 'error');
    }
}

function formatDate(dateString) {
    if (!dateString) return 'No date';
    const date = new Date(dateString);
    return date.toLocaleDateString();
}

function getCurrentProjectId() {
    return currentProject?._id || null;
}

async function completeTask() {
    if (!isTracking || !selectedTask) return;
    
    try {
        const userId = window.auth.getUserId();
        const token = window.auth.getToken();
        const projectId = selectedTask.project.projectId;
        
        // First stop the timer interval
        clearInterval(timerInterval);
        
        // Stop tracking in electron
        await window.electronAPI.stopTrackingBrowserActivity(userId, projectId, elapsedSeconds);
        
        // Update daily time in the database
        await updateDailyTime(
            selectedTask.taskId,
            elapsedSeconds,
            selectedTask.title,
            selectedTask.project.projectName
        );
        
        // Update task status to completed
        const taskResponse = await fetch(`${config.API_BASE_URL}/api/tasks/${selectedTask.taskId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                userId: userId,
                status: 'Completed',
                updatedAt: new Date().toISOString(),
                timing: {
                    ...selectedTask.timing,
                    worked: ((selectedTask.timing?.worked || 0) + (elapsedSeconds / 3600)).toFixed(2)
                }
            })
        });

        if (!taskResponse.ok) {
            throw new Error('Failed to update task status');
        }

        // Reset timer state
        elapsedSeconds = 0;
        elapsedTime.textContent = '00:00:00';
        isTracking = false;
        playButton.innerHTML = '<i class="fas fa-play"></i>';
        
        // Update the task status in the local arrays
        const taskIndex = allTasks.findIndex(t => t.taskId === selectedTask.taskId);
        if (taskIndex !== -1) {
            allTasks[taskIndex].status = 'Completed';
            // Update filtered tasks if they exist
            const filteredIndex = filteredTasks.findIndex(t => t.taskId === selectedTask.taskId);
            if (filteredIndex !== -1) {
                filteredTasks[filteredIndex].status = 'Completed';
            }
        }

        // Update the selected task status
        selectedTask.status = 'Completed';
        
        // Re-render the tasks to show the updated status
        renderTasks(filteredTasks.length ? filteredTasks : allTasks);
        
        // Update the task info display
        selectTask(selectedTask);
        
        // Show completion modal
        showCompletionModal();
        
        // Refresh stats
        await loadUserStats();
        
        displayNotification('Task completed successfully', 'success');
    } catch (error) {
        console.error('Error completing task:', error);
        displayNotification('Failed to complete task: ' + error.message, 'error');
        
        // Reset UI even if there's an error
        clearInterval(timerInterval);
        elapsedSeconds = 0;
        elapsedTime.textContent = '00:00:00';
        isTracking = false;
        playButton.innerHTML = '<i class="fas fa-play"></i>';
    }
}

function showCompletionModal() {
    // Create modal container
    const modalContainer = document.createElement('div');
    modalContainer.className = 'completion-modal';
    
    // Add completion SVG and message
    modalContainer.innerHTML = `
        <div class="completion-content">
            <svg width="165" height="165" viewBox="0 0 165 165" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M136.1 83.9C136.1 98.1 130.3 110.9 121 120.1C111.9 129.2 99.3 134.7 85.4 134.7C71.6 134.7 59 129.1 49.8 120.1C40.5 110.9 34.7 98.1 34.7 83.9C34.7 55.8 57.4 33.1 85.4 33.1C113.4 33.1 136.1 55.9 136.1 83.9Z" fill="#EAEEF9"/>
                <path d="M131.7 50.6C133.964 50.6 135.8 48.7643 135.8 46.5C135.8 44.2356 133.964 42.4 131.7 42.4C129.436 42.4 127.6 44.2356 127.6 46.5C127.6 48.7643 129.436 50.6 131.7 50.6Z" fill="#EAEEF9"/>
                <path d="M137.7 34.6C139.246 34.6 140.5 32.7464 140.5 30.4C140.5 28.1356 139.246 26.3 137.7 26.3C136.154 26.3 134.9 28.1356 134.9 30.4C134.9 32.6643 136.154 34.6 137.7 34.6Z" fill="#EAEEF9"/>
                <path d="M120.827 106.839C120.827 108.093 122.08 109.639 123.627 109.639C125.173 109.639 126.427 108.386 126.427 106.839C126.427 105.293 125.173 104.039 123.627 104.039C122.08 104.039 120.827 105.293 120.827 106.839Z" fill="#EAEEF9"/>
                <path d="M120.827 106.839C122.08 106.839 123.627 108.093 123.627 109.639C123.627 111.186 124.88 112.439 126.427 112.439C127.973 112.439 129.227 111.186 129.227 109.639C129.227 108.093 127.973 106.839 126.427 106.839Z" fill="#EAEEF9"/>
            </svg>
            <h2>Task Completed!</h2>
            <p>Great job! You've completed the task successfully.</p>
            <button class="continue-button" onclick="closeCompletionModal()">Continue</button>
        </div>
    `;
    
    document.body.appendChild(modalContainer);
    
    // Add animation class after a small delay
    setTimeout(() => {
        modalContainer.classList.add('active');
    }, 50);
}

function closeCompletionModal() {
    const modal = document.querySelector('.completion-modal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => {
            modal.remove();
        }, 300);
    }
}

// Update the electronAPI interface
window.electronAPI = {
    ...window.electronAPI,
    showCloseConfirmation: () => {
        return new Promise((resolve) => {
            const choice = confirm('Timer is still running. Do you want to stop tracking and close the application?');
            resolve(choice);
        });
    },
    closeWindow: async () => {
        try {
            // Send IPC message to main process to close the window
            await window.ipcRenderer.send('close-window');
        } catch (error) {
            console.error('Error closing window:', error);
        }
    }
};

// Update the styles
const taskStyles = `
    .task-row {
        display: grid;
        grid-template-columns: 2fr 1.5fr 1fr 0.8fr 1fr 1fr;
        padding: 16px;
        border-bottom: 1px solid var(--border-color);
        align-items: center;
        cursor: pointer;
        transition: background-color 0.2s;
    }

    .task-row:hover {
        background-color: var(--hover-color);
    }

    .task-title {
        font-weight: 500;
        color: var(--text-color);
    }

    .project-name {
        color: var(--text-light);
        font-size: 0.9em;
    }

    .priority-badge {
        padding: 4px 12px;
        border-radius: 4px;
        font-size: 0.85em;
        font-weight: 500;
    }

    .priority-high {
        background-color: #FEE2E2;
        color: #DC2626;
    }

    .priority-medium {
        background-color: #FEF3C7;
        color: #D97706;
    }

    .priority-low {
        background-color: #E5E7EB;
        color: #4B5563;
    }

    .priority-overdue {
        background-color: #7F1D1D;
        color: #FFFFFF;
    }

    .status-badge {
        padding: 4px 12px;
        border-radius: 4px;
        font-size: 0.85em;
        font-weight: 500;
        text-align: center;
    }

    .status-completed {
        background-color: #D1FAE5;
        color: #059669;
    }

    .status-not-started {
        background-color: #FEE2E2;
        color: #DC2626;
    }

    .status-in-progress {
        background-color: #FEF3C7;
        color: #D97706;
    }

    .status-blocked {
        background-color: #E5E7EB;
        color: #4B5563;
    }

    .selected-task-info {
        padding: 16px;
    }

    .selected-task-info .project-name {
        font-size: 1.1em;
        font-weight: 600;
        margin-bottom: 8px;
    }

    .selected-task-info .task-name {
        font-size: 0.95em;
        color: var(--text-light);
        margin-bottom: 16px;
    }

    .task-meta {
        display: flex;
        gap: 16px;
        margin-bottom: 16px;
        font-size: 0.9em;
        color: var(--text-light);
    }

    .task-details {
        font-size: 0.9em;
        color: var(--text-light);
    }
`;

// Add the styles to the document
const styleElement = document.createElement('style');
styleElement.textContent = taskStyles;
document.head.appendChild(styleElement); 

// Add search functionality
function setupSearch() {
    const searchInput = document.querySelector('.search-bar input');
    if (!searchInput) return;

    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase().trim();
        currentPage = 1; // Reset to first page when searching
        
        if (!searchTerm) {
            filteredTasks = [...allTasks];
        } else {
            filteredTasks = allTasks.filter(task => {
                const titleMatch = task.title?.toLowerCase().includes(searchTerm);
                const projectMatch = task.project?.projectName?.toLowerCase().includes(searchTerm);
                const statusMatch = task.status?.toLowerCase().includes(searchTerm);
                const priorityMatch = task.priority?.toLowerCase().includes(searchTerm);
                
                return titleMatch || projectMatch || statusMatch || priorityMatch;
            });
        }
        
        renderTasks(filteredTasks);
    });
} 

// Add pagination update function
function updatePagination(totalTasks) {
    const totalPages = Math.ceil(totalTasks / tasksPerPage);
    const pagination = document.querySelector('.pagination');
    
    if (totalPages <= 1) {
        pagination.style.display = 'none';
        return;
    }
    
    pagination.style.display = 'flex';
    
    // Calculate visible page numbers
    let pageNumbers = [];
    if (totalPages <= 7) {
        pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);
    } else {
        if (currentPage <= 4) {
            pageNumbers = [1, 2, 3, 4, 5, '...', totalPages];
        } else if (currentPage >= totalPages - 3) {
            pageNumbers = [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
        } else {
            pageNumbers = [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages];
        }
    }
    
    // Generate pagination HTML
    const paginationHTML = `
        <button class="first-page" ${currentPage === 1 ? 'disabled' : ''} title="First Page">
            <i class="fas fa-angle-double-left"></i>
        </button>
        <button class="prev-page" ${currentPage === 1 ? 'disabled' : ''} title="Previous Page">
            <i class="fas fa-angle-left"></i>
        </button>
        <div class="page-numbers">
            ${pageNumbers.map(num => {
                if (num === '...') {
                    return '<span class="ellipsis">...</span>';
                }
                return `<button class="page-number ${num === currentPage ? 'active' : ''}" data-page="${num}">${num}</button>`;
            }).join('')}
        </div>
        <button class="next-page" ${currentPage === totalPages ? 'disabled' : ''} title="Next Page">
            <i class="fas fa-angle-right"></i>
        </button>
        <button class="last-page" ${currentPage === totalPages ? 'disabled' : ''} title="Last Page">
            <i class="fas fa-angle-double-right"></i>
        </button>
    `;
    
    // Remove old event listener if it exists
    const oldPagination = pagination.cloneNode(true);
    pagination.parentNode.replaceChild(oldPagination, pagination);
    
    // Set the new HTML
    oldPagination.innerHTML = paginationHTML;
    
    // Add the new event listener
    oldPagination.addEventListener('click', handlePaginationClick);
}

// Separate function to handle pagination clicks
function handlePaginationClick(e) {
    const target = e.target.closest('button');
    if (!target || target.disabled) return;

    const totalPages = Math.ceil((filteredTasks.length || allTasks.length) / tasksPerPage);
    let newPage = currentPage;

    if (target.classList.contains('first-page')) {
        newPage = 1;
    } else if (target.classList.contains('prev-page')) {
        newPage = Math.max(1, currentPage - 1);
    } else if (target.classList.contains('next-page')) {
        newPage = Math.min(totalPages, currentPage + 1);
    } else if (target.classList.contains('last-page')) {
        newPage = totalPages;
    } else if (target.classList.contains('page-number')) {
        newPage = parseInt(target.dataset.page);
    }

    if (newPage !== currentPage) {
        currentPage = newPage;
        renderTasks(filteredTasks.length ? filteredTasks : allTasks);
    }
}

// Function to update daily time
async function updateDailyTime(taskId, totalSeconds, title, projectName) {
    try {
        const userId = window.auth.getUserId();
        const token = window.auth.getToken();
        
        if (!userId || !token) {
            throw new Error('User not authenticated');
        }

        // Calculate the new session time by subtracting the existing time
        let existingSeconds = 0;
        if (selectedTask && selectedTask.timing?.timeLogged) {
            const timeMatch = selectedTask.timing.timeLogged.match(/(\d+)h\s*(\d+)m/);
            if (timeMatch) {
                const hours = parseInt(timeMatch[1]) || 0;
                const minutes = parseInt(timeMatch[2]) || 0;
                existingSeconds = (hours * 3600) + (minutes * 60);
            }
        }

        // Calculate only the new time tracked in this session
        const newSessionSeconds = Math.max(0, totalSeconds - existingSeconds);

        const today = new Date().toISOString().split('T')[0];

        // Update daily time with only the new session time
        const response = await fetch('https://actracker.onrender.com/api/daily-time/update', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                userId,
                date: today,
                taskId: taskId || 'default',
                seconds: newSessionSeconds, // Only send the new session time
                title: title || 'Untitled Task',
                projectName: projectName || 'Default Project'
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to update daily time');
        }

        // Update task's total time logged
        if (taskId) {
            try {
                // Use total elapsed time for the task's time logged
                const hours = Math.floor(totalSeconds / 3600);
                const minutes = Math.floor((totalSeconds % 3600) / 60);
                const timeLogged = `${hours}h ${minutes}m`;

                const taskResponse = await fetch(`${config.API_BASE_URL}/api/tasks/${taskId}`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({
                        timing: {
                            timeLogged: timeLogged
                        }
                    })
                });

                if (!taskResponse.ok) {
                    throw new Error('Failed to update task time logged');
                }

                // Update local task data
                if (selectedTask) {
                    selectedTask.timing = {
                        ...selectedTask.timing,
                        timeLogged: timeLogged
                    };
                    updateTaskInArrays(selectedTask);
                }
            } catch (error) {
                console.error('Error updating task time:', error);
            }
        }

        const data = await response.json();
        await loadUserStats();
        return data;
    } catch (error) {
        console.error('Error updating daily time:', error);
        displayNotification('Failed to update time tracking: ' + error.message, 'error');
        throw error;
    }
} 

// Add this after setupEventListeners function
function setupRecurringTaskFields() {
    const recurringToggle = document.getElementById('recurring-toggle');
    const recurringFields = document.querySelectorAll('.recurring-fields');
    const dayCheckboxes = document.querySelectorAll('input[name="days"]');
    const untilDateInput = document.getElementById('until-date');

    if (recurringToggle) {
        recurringToggle.addEventListener('change', (e) => {
            const isRecurring = e.target.checked;
            
            // Show/hide recurring fields
            recurringFields.forEach(field => {
                field.style.display = isRecurring ? 'block' : 'none';
            });
            
            // Enable/disable day checkboxes and until date
            dayCheckboxes.forEach(checkbox => {
                checkbox.disabled = !isRecurring;
                if (!isRecurring) {
                    checkbox.checked = false;
                }
            });
            
            untilDateInput.disabled = !isRecurring;
            if (!isRecurring) {
                untilDateInput.value = '';
            }
        });
    }
}

function formatTime(hours, minutes, seconds) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Add these new filter-related functions
function openFilterModal() {
    const filterModal = document.getElementById('filter-modal');
    const filterOverlay = document.getElementById('filter-overlay');
    const filterIcon = document.getElementById('filter-icon');
    
    filterModal.classList.add('active');
    filterOverlay.classList.add('active');
    filterIcon.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    // Populate dynamic content
    populateAssigneeFilter();
    populateProjectFilter();
    
    // Set current filter values
    setCurrentFilterValues();
}

function closeFilterModal() {
    const filterModal = document.getElementById('filter-modal');
    const filterOverlay = document.getElementById('filter-overlay');
    const filterIcon = document.getElementById('filter-icon');
    
    filterModal.classList.remove('active');
    filterOverlay.classList.remove('active');
    filterIcon.classList.remove('active');
    document.body.style.overflow = '';
}

function clearFilters() {
    // Reset all checkboxes and selections
    document.querySelectorAll('.filter-option input[type="checkbox"]').forEach(checkbox => {
        checkbox.checked = false;
        checkbox.closest('.filter-option').classList.remove('selected');
    });
    
    document.querySelectorAll('.avatar-filter .avatar').forEach(avatar => {
        avatar.classList.remove('selected');
    });
    
    document.getElementById('filter-start-date').value = '';
    document.getElementById('filter-due-date').value = '';
    
    // Reset active filters
    activeFilters = {
        assignees: [],
        status: [],
        priority: [],
        projects: [],
        dateRange: {
            start: null,
            end: null
        }
    };
    
    // Update tasks display
    filterTasks();
}

function applyFilters() {
    // Collect filter values
    activeFilters.status = Array.from(document.querySelectorAll('#status-filter input:checked'))
        .map(checkbox => checkbox.closest('.filter-option').dataset.status);
    
    activeFilters.priority = Array.from(document.querySelectorAll('#priority-filter input:checked'))
        .map(checkbox => checkbox.closest('.filter-option').dataset.priority);
    
    activeFilters.projects = Array.from(document.querySelectorAll('#project-filter input:checked'))
        .map(checkbox => checkbox.closest('.filter-option').dataset.project);
    
    activeFilters.assignees = Array.from(document.querySelectorAll('.avatar-filter .avatar.selected'))
        .map(avatar => avatar.dataset.userId);
    
    activeFilters.dateRange = {
        start: document.getElementById('filter-start-date').value,
        end: document.getElementById('filter-due-date').value
    };
    
    // Apply filters and close modal
    filterTasks();
    closeFilterModal();
}

function filterTasks() {
    filteredTasks = allTasks.filter(task => {
        // Status filter
        if (activeFilters.status.length && !activeFilters.status.includes(task.status)) {
            return false;
        }
        
        // Priority filter
        if (activeFilters.priority.length && !activeFilters.priority.includes(task.priority)) {
            return false;
        }
        
        // Project filter
        if (activeFilters.projects.length && !activeFilters.projects.includes(task.project?.projectId)) {
            return false;
        }
        
        // Assignee filter
        if (activeFilters.assignees.length && !activeFilters.assignees.includes(task.assignee?.userId)) {
            return false;
        }
        
        // Date range filter
        if (activeFilters.dateRange.start && new Date(task.timing?.startDate) < new Date(activeFilters.dateRange.start)) {
            return false;
        }
        if (activeFilters.dateRange.end && new Date(task.timing?.dueDate) > new Date(activeFilters.dateRange.end)) {
            return false;
        }
        
        return true;
    });
    
    currentPage = 1; // Reset to first page
    renderTasks(filteredTasks);
}

async function populateAssigneeFilter() {
    try {
        const response = await fetch(`${config.API_BASE_URL}/api/users`, {
            headers: {
                'Authorization': `Bearer ${window.auth.getToken()}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to load users');
        }
        
        const users = await response.json();
        const assigneeFilter = document.getElementById('assignee-filter');
        
        assigneeFilter.innerHTML = users.map(user => `
            <div class="avatar ${activeFilters.assignees.includes(user.userId) ? 'selected' : ''}"
                 data-user-id="${user.userId}"
                 title="${user.name}">
                ${user.name.charAt(0).toUpperCase()}
            </div>
        `).join('');
        
        // Add click handlers
        assigneeFilter.querySelectorAll('.avatar').forEach(avatar => {
            avatar.addEventListener('click', () => {
                avatar.classList.toggle('selected');
            });
        });
        
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

async function populateProjectFilter() {
    try {
        const projects = await loadProjects();
        const projectFilter = document.getElementById('project-filter');
        
        projectFilter.innerHTML = projects.map(project => `
            <div class="filter-option" data-project="${project._id}">
                <input type="checkbox" id="project-${project._id}"
                       ${activeFilters.projects.includes(project._id) ? 'checked' : ''}>
                <label for="project-${project._id}">${project.projectName}</label>
            </div>
        `).join('');
        
        // Add click handlers
        projectFilter.querySelectorAll('.filter-option').forEach(option => {
            option.addEventListener('click', (e) => {
                const checkbox = option.querySelector('input[type="checkbox"]');
                if (e.target !== checkbox) {
                    checkbox.checked = !checkbox.checked;
                }
                option.classList.toggle('selected', checkbox.checked);
            });
        });
        
    } catch (error) {
        console.error('Error loading projects:', error);
    }
}

function setCurrentFilterValues() {
    // Set status checkboxes
    activeFilters.status.forEach(status => {
        const checkbox = document.querySelector(`#status-filter [data-status="${status}"] input`);
        if (checkbox) {
            checkbox.checked = true;
            checkbox.closest('.filter-option').classList.add('selected');
        }
    });
    
    // Set priority checkboxes
    activeFilters.priority.forEach(priority => {
        const checkbox = document.querySelector(`#priority-filter [data-priority="${priority}"] input`);
        if (checkbox) {
            checkbox.checked = true;
            checkbox.closest('.filter-option').classList.add('selected');
        }
    });
    
    // Set date range
    if (activeFilters.dateRange.start) {
        document.getElementById('filter-start-date').value = activeFilters.dateRange.start;
    }
    if (activeFilters.dateRange.end) {
        document.getElementById('filter-due-date').value = activeFilters.dateRange.end;
    }
}