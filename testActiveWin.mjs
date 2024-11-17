import { activeWindow } from 'active-win';

(async () => {
    try {
        const window = await activeWindow(); // Call activeWindow to get the active window information
        console.log("Test Active Window Info:", window);
    } catch (error) {
        console.error("Error in active-win test:", error);
    }
})();
