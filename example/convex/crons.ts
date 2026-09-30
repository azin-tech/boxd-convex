import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();

// Destroys demo machines that outlived their slot.
crons.interval("sweep demo machines", { minutes: 1 }, internal.demo.sweep, {});

export default crons;
